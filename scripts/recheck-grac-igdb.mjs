// 게임위 게임이 IGDB에 있는지 다시 확인: `npm run recheck:grac-igdb`
// 예전 방식(정확히 같은 이름만)으로 'IGDB에 없음'이 된 게임위 게임을 새 방식으로 다시 확인합니다.
//  - 새 방식: 괄호 안 이름('Portal 2(포탈 2)_PC' → Portal 2, 포탈 2), 플랫폼 표기 제거, 전각 기호 정리, 영문 이름은 slug로도
//  - 괄호 안 이름 등 '꺼낸 이름'으로만 맞을 때는 플랫폼(PC·모바일·콘솔·아케이드)도 맞아야 같은 게임으로 봄
//  - IGDB에 있으면 게임위 카드 대신 IGDB 카드로 보임(표지·평점·인원 정보가 더 많음)
//
//   npm run recheck:grac-igdb                 화면에 보이는 게임위 게임 중 확인 안 된 것 전부 (약 9천 개, 20분 안팎)
//   npm run recheck:grac-igdb -- --limit 2000 2000개만
//   npm run recheck:grac-igdb -- --dry        몇 개인지만
//
// - 대상: 화면에 보이는 게임위 게임만(목록의 숨김 규칙과 같음, 아케이드 기계·교육용·체험판 제외) — AI가 '서비스 중'이라 했거나 App Store에 있거나 '출시 예정'.
//   AI가 '종료'로 판단한 게임, 상태를 모르는 게임(HIDE_UNKNOWN_GRAC=on일 때)은 어차피 안 보이므로 건너뜀
// - 결과는 .cache/grac-igdb-check.json 에 저장(20묶음마다). 중간에 꺼도 다시 실행하면 이어서 합니다.
import { getConfig } from '../server/config.js';
import { createIgdbProvider } from '../server/providers/igdbProvider.js';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createGracProvider } from '../server/providers/gracProvider.js';
import { createExistenceCache } from '../server/services/catalog.js';
import { createPartySize } from '../server/services/partySize.js';
import { createAppArt } from '../server/services/appArt.js';
import { isOffTopic } from '../server/services/taxonomy.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number(v);
};
const LIMIT = Number(opt('limit', Infinity));
const DRY = opt('dry', false) === true;

const config = getConfig();
const igdb = createIgdbProvider(config.igdb ?? {});
if (!igdb.configured) {
  console.log('.env 에 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET 이 없어요.');
  process.exit(1);
}
const snap = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile }).snapshot();
if (snap.status !== 'ready') {
  console.log('게임위 목록(.cache/grac-index.json)이 없어요. 서버를 한 번 켜서 목록을 받은 뒤 다시 실행하세요.');
  process.exit(1);
}
const cache = createExistenceCache(config.grac.igdbCheckFile);
// 화면에 보이는 게임위 게임 (server/app.js 의 listable 과 같은 기준)
const ps = createPartySize({ ...config.gemini, live: false });
const art = createAppArt(config.appStore.artFile);
const visible = art
  .applyAll(ps.applyCached(snap.games))
  .filter((g) => !g.aiEnded && !isOffTopic(g) && (g.aiUpcoming || g.aiAlive || g.appStoreUrl || !config.hideUnknownGrac));
const before = snap.games.filter((g) => cache.known(g.title) === true).length;
const todo = visible.filter((g) => cache.known(g.title) === undefined).slice(0, LIMIT);
console.log(`게임위 게임 ${snap.games.length}개 (IGDB에 있음 ${before}개) · 화면에 보이는 게임 ${visible.length}개 중 다시 확인할 게임 ${todo.length}개`);
if (DRY || !todo.length) process.exit(0);

const chunks = [];
for (let i = 0; i < todo.length; i += 12) chunks.push(todo.slice(i, i + 12));
let next = 0;
let done = 0;
let found = 0;
let failed = 0;
const t0 = Date.now();
const worker = async () => {
  while (next < chunks.length) {
    const c = chunks[next++];
    const raw = new Map(c.map((g) => [g.title, g.platformsRaw]));
    try {
      // 기다린 뒤에 더함(`found += await …`는 기다리기 전 값을 읽어 동시 작업끼리 서로 덮어씀)
      const hit = await cache.check(c.map((g) => g.title), (names) => igdb.findTitleGames(names), { platformsOf: (t) => raw.get(t) });
      found += hit.size;
    } catch (e) {
      failed++;
      console.log(`\n⚠ IGDB 확인 실패(이 묶음은 다음 실행 때 다시): ${e.message}`);
    }
    done++;
    if (done % 20 === 0 || done === chunks.length) {
      cache.save();
      const left = Math.round(((Date.now() - t0) / done) * (chunks.length - done) / 60000);
      process.stdout.write(`\r${Math.min(done * 12, todo.length)}/${todo.length} 확인 · IGDB에서 새로 찾음 ${found}개 · 남은 시간 약 ${left}분   `);
    }
  }
};
// 동시에 6묶음 (IGDB 초당 4회 제한은 igdbProvider 의 slot() 이 지킴. 동시 요청 한도 8개를 넘지 않게 6)
await Promise.all(Array.from({ length: 6 }, worker));
cache.save();
console.log(`\n✅ 끝: ${todo.length}개 중 IGDB에서 찾음 ${found}개${failed ? ` · 실패 ${failed}묶음(다시 실행하면 이어서)` : ''}`);
console.log('서버가 켜져 있으면 껐다 켜야 반영돼요(확인 결과는 서버가 켤 때 읽음).');
