// 유료·무료 미리 저장: `npm run prefill:price`
// 스토어 근거를 먼저 쓰고, 스토어가 없는 게임만 AI에게 물어 server/data/price.json 에 저장합니다. 서버는 이 파일만 읽습니다.
//
//   npm run prefill:price                    1) Steam  2) App Store  (키 필요 없음)
//   npm run prefill:price -- --ai            3) 스토어 근거가 없는 IGDB 게임을 AI(Gemini)에게 (GEMINI_API_KEY 필요)
//   npm run prefill:price -- --only steam    steam | appstore | ai 하나만
//   npm run prefill:price -- --pages 10      후보 목록 깊이(목록마다 50개씩 N쪽, 기본 4쪽 = 200위)
//   npm run prefill:price -- --limit 300     Steam·AI 확인 게임 수 상한(기본 1000)
//   npm run prefill:price -- --recheck       이미 확인한 게임도 다시 (가격 정책이 바뀌었을 때)
//   npm run prefill:price -- --dry           개수만
//
// - 후보: 사람들이 많이 보는 IGDB 게임(첫 화면·인기·평점·신작·장르별 인기, prefill:playtime 과 같은 목록)
// - Steam: 상점 API appdetails 의 is_free (출시 전이면 '모름'). 5분에 200번 제한이 있어 1.6초 간격
// - App Store: 게관위 모바일 게임 중 App Store 아이콘을 찾은 게임(app-store.json)의 가격 0원 여부, 100개씩 묶어 조회
// - AI: 잘 모르는 게임은 '모름'(free: null)으로 저장. 화면에는 'AI 추정'으로 표시
// - 중간에 꺼도(Ctrl+C) 저장되고 다시 실행하면 이어서 합니다. 서버가 켜져 있으면 30초 안에 반영
import fs from 'node:fs';
import { getConfig } from '../server/config.js';
import { createIgdbProvider } from '../server/providers/igdbProvider.js';
import { GENRES } from '../server/services/taxonomy.js';
import { GEMINI_API_BASE } from '../server/services/partySize.js';
import { appStoreFree, appStoreId, buildPricePrompt, createPricing, parsePriceAnswer, STORE_SOURCES, steamFree } from '../server/services/pricing.js';
import { steamAppId } from '../server/services/steamTrailer.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
const ONLY = opt('only', null);
const STEPS = new Set(ONLY ? [ONLY] : ['steam', 'appstore', ...(opt('ai', false) === true ? ['ai'] : [])]);
const PAGES = Number(opt('pages', 4));
const LIMIT = Number(opt('limit', 1000));
const RECHECK = opt('recheck', false) === true;
const DRY = opt('dry', false) === true;
const BATCH = 20; // AI 한 번에 묻는 게임 수
const AI_GAP = 4500; // 분당 약 13번
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = getConfig();
const store = createPricing(config.pricing.dataFile);
console.log(`유료·무료 미리 저장 · ${config.pricing.dataFile} (저장 ${store.size}개) · 할 일: ${[...STEPS].join(', ')}`);
process.on('SIGINT', () => {
  store.save();
  console.log('\n중단 · 저장함');
  process.exit(130);
});

// 후보: IGDB 인기 목록 (Steam·AI 단계에만 필요)
let candidates = [];
if (STEPS.has('steam') || STEPS.has('ai')) {
  if (!config.igdb.clientId || !config.igdb.clientSecret) {
    console.log('.env 에 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET 이 없어 후보 게임 목록을 만들 수 없어요.');
    process.exit(1);
  }
  const igdb = createIgdbProvider(config.igdb);
  const seen = new Map();
  const add = (games) => {
    for (const g of games) if (g.id?.startsWith('igdb-') && !seen.has(g.id)) seen.set(g.id, g);
  };
  add(await igdb.featured(30));
  for (const [kind, genre] of [['popular'], ['top'], ['recent'], ...GENRES.map((g) => ['popular', g.value])]) {
    for (let p = 0; p < (genre ? Math.ceil(PAGES / 2) : PAGES); p++) {
      const { games, hasMore } = await igdb.browse(kind, { genre, offset: p * 50, limit: 50 });
      add(games);
      if (!hasMore) break;
    }
  }
  candidates = [...seen.values()];
  console.log(`IGDB 후보 ${candidates.length}개`);
}
const todo = (g) => RECHECK || !store.has(g.id);

// 1) Steam
if (STEPS.has('steam')) {
  const list = candidates.filter((g) => steamAppId(g) && (RECHECK || !STORE_SOURCES.has(store.entry(g.id)?.source))).slice(0, LIMIT);
  console.log(`1) Steam: ${list.length}개 (약 ${Math.ceil((list.length * 1.9) / 60)}분)`);
  if (!DRY) {
    let free = 0, paid = 0, unknown = 0;
    for (const [i, g] of list.entries()) {
      const appid = steamAppId(g);
      try {
        const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=kr&filters=basic,release_date`, { signal: AbortSignal.timeout(10_000) });
        if (r.status === 429 || r.status === 403) {
          console.log('  Steam 호출 제한 → 5분 쉼');
          await sleep(5 * 60e3);
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const v = steamFree(await r.json(), appid);
        if (v === null) unknown++;
        else {
          store.set(g.id, v, 'steam', { appid });
          v ? free++ : paid++;
        }
      } catch (e) {
        console.log(`  ${g.title}: ${e.message}`);
      }
      if ((i + 1) % 25 === 0) {
        store.save();
        console.log(`  ${i + 1}/${list.length} (무료 ${free}, 유료 ${paid}, 모름 ${unknown})`);
      }
      await sleep(1600);
    }
    store.save();
    console.log(`  끝 · 무료 ${free}, 유료 ${paid}, 모름(출시 전 등) ${unknown}`);
  }
}

// 2) App Store (게관위 모바일 게임)
if (STEPS.has('appstore')) {
  let art = {};
  try {
    art = JSON.parse(fs.readFileSync(config.appStore.artFile, 'utf8'));
  } catch {
    /* 없으면 건너뜀 */
  }
  const list = Object.entries(art)
    .filter(([key, e]) => e?.storeUrl && appStoreId(e.storeUrl) && (RECHECK || !store.has(key)))
    .map(([key, e]) => ({ key, id: appStoreId(e.storeUrl) }));
  console.log(`2) App Store: ${list.length}개`);
  if (!DRY) {
    let free = 0, paid = 0;
    for (let i = 0; i < list.length; i += 100) {
      const part = list.slice(i, i + 100);
      try {
        const r = await fetch(`https://itunes.apple.com/lookup?id=${part.map((x) => x.id).join(',')}&country=kr`, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const byId = new Map(((await r.json()).results ?? []).map((a) => [String(a.trackId), a]));
        for (const x of part) {
          const v = appStoreFree(byId.get(x.id));
          if (v === null) continue; // 내려간 앱 등: 적지 않음
          store.set(x.key, v, 'appstore', { appId: x.id });
          v ? free++ : paid++;
        }
      } catch (e) {
        console.log(`  App Store 오류: ${e.message}`);
      }
      store.save();
      await sleep(3000);
    }
    console.log(`  끝 · 무료 ${free}, 유료 ${paid}`);
  }
}

// 3) AI (스토어 근거가 없는 IGDB 게임만)
if (STEPS.has('ai')) {
  const apiKey = config.gemini.apiKey;
  const model = config.gemini.model || 'gemini-flash-lite-latest';
  const list = candidates.filter((g) => !steamAppId(g) && todo(g)).slice(0, LIMIT);
  console.log(`3) AI(${model}): ${list.length}개 → 질문 ${Math.ceil(list.length / BATCH)}번`);
  if (!DRY && list.length) {
    if (!apiKey) {
      console.log('.env 에 GEMINI_API_KEY 가 없어 AI 단계를 건너뜁니다.');
    } else {
      let free = 0, paid = 0, unknown = 0;
      for (let i = 0; i < list.length; i += BATCH) {
        const part = list.slice(i, i + BATCH);
        const r = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: buildPricePrompt(part) }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, known: { type: 'BOOLEAN' }, free: { type: 'BOOLEAN', nullable: true } }, required: ['i', 'known', 'free'] } },
            },
          }),
          signal: AbortSignal.timeout(60_000),
        }).catch((e) => ({ ok: false, status: 0, error: e }));
        if (r.status === 429) {
          console.log('  Gemini 무료 사용량 초과 → 멈춤(내일 다시 실행하면 이어서)');
          break;
        }
        if (!r.ok) {
          console.log(`  Gemini 오류 (HTTP ${r.status}) → 이 묶음 건너뜀`);
          await sleep(AI_GAP);
          continue;
        }
        const body = await r.json().catch(() => null);
        let answer = [];
        try {
          answer = JSON.parse(body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '[]');
        } catch {
          /* 해석 못 하면 모두 건너뜀(저장 안 함) */
        }
        const got = parsePriceAnswer(answer);
        part.forEach((g, k) => {
          if (!got.has(k)) return; // 답이 빠진 게임은 다음에 다시
          const v = got.get(k);
          store.set(g.id, v, 'ai', { model });
          v === null ? unknown++ : v ? free++ : paid++;
        });
        store.save();
        console.log(`  ${Math.min(i + BATCH, list.length)}/${list.length} (무료 ${free}, 유료 ${paid}, 모름 ${unknown})`);
        await sleep(AI_GAP);
      }
    }
  }
}
store.save();
console.log(`완료 · 파일 전체 ${store.size}개`);
