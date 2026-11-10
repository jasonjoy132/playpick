// 게임위 모바일 게임 아이콘 미리 받기: `npm run prefill:images`
// 화면에 게임위 카드로 보이는 모바일 게임(IGDB에 없는 것, AI가 '종료'로 판단한 게임 제외)을
// App Store 검색 API로 찾아, 앱 이름과 개발사가 모두 같을 때만 아이콘·스크린샷·App Store 링크를 server/data/app-store.json 에 저장합니다.
//
//   npm run prefill:images                 최신 등급분류 순으로 전부
//   npm run prefill:images -- --limit 500  500개만
//   npm run prefill:images -- --dry        개수·예상 시간만
//   npm run prefill:images -- --retry      예전에 못 찾은 게임도 다시
//
// - App Store 검색은 키가 필요 없고, 분당 약 20번 제한이 있어 3.5초에 한 번씩 천천히 묻습니다(몇 시간 걸릴 수 있음).
// - 이미 확인한 게임은 건너뛰므로 중간에 꺼도(Ctrl+C) 다시 실행하면 이어서 합니다. 서버가 켜져 있으면 30초 안에 반영.
import fs from 'node:fs';
import { getConfig } from '../server/config.js';
import { createGracProvider } from '../server/providers/gracProvider.js';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createExistenceCache } from '../server/services/catalog.js';
import { createPartySize } from '../server/services/partySize.js';
import { createAppArt } from '../server/services/appArt.js';
import { APPSTORE_SEARCH, matchApp, screenshotsOf } from '../server/providers/appStoreProvider.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
const LIMIT = opt('limit', Infinity);
const DRY = opt('dry', false) === true;
const RETRY = opt('retry', false) === true;
const GAP = Math.max(Number(opt('gap', 3500)), 1000); // 호출 간격(ms)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMAGE_HOST = /^https:\/\/is\d+-ssl\.mzstatic\.com\//;
const STORE_HOST = /^https:\/\/apps\.apple\.com\//;

const config = getConfig();
const art = createAppArt(config.appStore.artFile);
console.log(`게임위 모바일 게임 아이콘 미리 받기 · 저장 파일 ${config.appStore.artFile} (이미 확인 ${art.size}개)`);

// 1) 화면에 보이는 게임위 모바일 게임
const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed, log: (m) => console.log(m) });
let snap = index.snapshot();
if (snap.status !== 'ready') {
  console.log('게임위 전체 목록을 받는 중… (처음 한 번 몇 분)');
  await index.ensure();
  snap = index.snapshot();
}
if (snap.status !== 'ready') {
  console.log(`게임위 목록을 받지 못했어요 (${snap.error ?? ''})`);
  process.exit(1);
}
let exists = {};
try {
  exists = JSON.parse(fs.readFileSync(config.grac.igdbCheckFile, 'utf8'));
} catch {
  /* 없음 */
}
const ps = createPartySize({ ...config.gemini, live: false });
const isMobile = (g) => g.platforms?.includes('mobile') || /모바일/.test(g.platformsRaw || '');
const visible = ps
  .applyCached(snap.games.filter((g) => !exists[g.title]?.exists && isMobile(g) && g.publisher))
  .filter((g) => !g.aiEnded)
  .sort((a, b) => String(b.ratingDate || '').localeCompare(String(a.ratingDate || '')));
// 처음 보는 게임 + 예전에 아이콘만 받아 둔 게임(스크린샷 받으러) + (--retry) 못 찾은 게임
const todo = visible.filter((g) => !art.has(g) || art.needsShots(g) || (RETRY && !art.apply(g).imageUrl)).slice(0, LIMIT);
console.log(`보이는 게임위 모바일 게임 ${visible.length}개 중 확인할 게임 ${todo.length}개 → ${(GAP / 1000).toFixed(1)}초 간격, 예상 약 ${Math.ceil((todo.length * GAP) / 60000)}분`);
if (DRY || !todo.length) process.exit(0);

// 2) App Store 검색 (이름 + 개발사 모두 같을 때만)
async function search(term) {
  const url = new URL(APPSTORE_SEARCH);
  url.searchParams.set('term', term);
  url.searchParams.set('country', 'kr');
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', '10');
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 403 || res.status === 429) throw Object.assign(new Error(`App Store 호출 제한 (HTTP ${res.status})`), { limited: true });
  if (!res.ok) throw new Error(`App Store HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.results) ? body.results : [];
}

let found = 0;
let none = 0;
let limitedRow = 0;
const t0 = Date.now();
for (let i = 0; i < todo.length; i++) {
  const g = todo[i];
  try {
    const m = matchApp(await search(g.title), { title: g.title, publisher: g.publisher });
    const image = m?.artworkUrl512 || m?.artworkUrl100 || null;
    if (m && STORE_HOST.test(String(m.trackViewUrl))) {
      art.set(g, { imageUrl: image && IMAGE_HOST.test(image) ? image : null, storeUrl: m.trackViewUrl, appName: m.trackName, seller: m.sellerName || m.artistName, screenshots: screenshotsOf(m) });
      found++;
    } else {
      art.set(g, { none: true });
      none++;
    }
    limitedRow = 0;
  } catch (e) {
    if (e.limited) {
      limitedRow++;
      if (limitedRow > 5) {
        console.log('\n⛔ App Store 호출 제한이 계속돼 멈춥니다. 잠시 뒤 같은 명령을 다시 실행하면 이어서 합니다.');
        break;
      }
      console.log(`⏳ ${e.message} — 1분 쉬었다 다시`);
      await sleep(60_000);
      i--; // 같은 게임 다시
      continue;
    }
    console.log(`⚠ ${g.title}: ${e.message} — 건너뜀(다음 실행 때 다시)`);
  }
  if ((i + 1) % 20 === 0 || i === todo.length - 1) {
    art.save();
    const left = Math.round((((Date.now() - t0) / (i + 1)) * (todo.length - i - 1)) / 60000);
    console.log(`[${i + 1}/${todo.length}] 아이콘 찾음 ${found}개 · App Store에 없음 ${none}개 · 남은 시간 약 ${left}분`);
  }
  await sleep(GAP);
}
art.save();
console.log(`\n✅ 끝: 아이콘 찾음 ${found}개, 없음 ${none}개 → ${config.appStore.artFile}`);
console.log('서버가 켜져 있으면 30초 안에 목록·검색 카드에 아이콘이 나옵니다.');
