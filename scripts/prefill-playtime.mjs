// RAWG 평균 플레이 시간 미리 받기: `npm run prefill:playtime`
// 사람들이 많이 여는 IGDB 게임(첫 화면·인기·평점 랭킹·신작·장르별 인기)을 RAWG에서 찾아
// server/data/rawg-playtime.json 에 저장합니다. 서버는 이 파일만 읽고 RAWG를 실시간으로 부르지 않습니다.
//
//   npm run prefill:playtime                     게임 500개 확인 (기본)
//   npm run prefill:playtime -- --limit 2000     2000개 확인
//   npm run prefill:playtime -- --pages 10       목록마다 50개씩 10쪽(500위)까지 후보로 (기본 4쪽 = 200위)
//   npm run prefill:playtime -- --dry            후보 수·예상 RAWG 호출 수만
//   npm run prefill:playtime -- --retry          예전에 RAWG에서 못 찾은 게임도 다시
//
// - RAWG 무료 키는 월 20,000건. 게임 하나에 최대 2번 검색하므로 --limit 로 나눠 돌리세요.
// - 이미 확인한 게임은 건너뛰므로 중간에 꺼도(Ctrl+C) 다시 실행하면 이어서 합니다. 서버가 켜져 있으면 30초 안에 반영.
// - RAWG가 오류(5xx·호출 제한·시간 초과)를 내면 그 자리에서 멈춥니다. 그 게임은 '못 찾음'으로 적지 않습니다.
import { getConfig } from '../server/config.js';
import { createIgdbProvider } from '../server/providers/igdbProvider.js';
import { createRawgProvider } from '../server/providers/rawgProvider.js';
import { createRawgPlaytime } from '../server/services/rawgPlaytime.js';
import { GENRES } from '../server/services/taxonomy.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
const LIMIT = Number(opt('limit', 500));
const PAGES = Number(opt('pages', 4));
const DRY = opt('dry', false) === true;
const RETRY = opt('retry', false) === true;
const GAP = Math.max(Number(opt('gap', 400)), 200); // 게임 사이 간격(ms)
const PAGE = 50;
const SAVE_EVERY = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = getConfig();
if (!config.rawg.apiKey) {
  console.log('.env 에 RAWG_API_KEY 가 없어요. https://rawg.io/apidocs 에서 키를 받아 .env 에 넣어 주세요.');
  process.exit(1);
}
if (!config.igdb.clientId || !config.igdb.clientSecret) {
  console.log('.env 에 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET 이 없어 후보 게임 목록을 만들 수 없어요.');
  process.exit(1);
}
const store = createRawgPlaytime(config.rawg.dataFile);
const rawg = createRawgProvider(config.rawg);
const igdb = createIgdbProvider(config.igdb);
console.log(`RAWG 플레이 시간 미리 받기 · 저장 파일 ${config.rawg.dataFile} (이미 확인 ${store.size}개)`);

// 1) 후보: 사람들이 많이 보는 목록 순서대로 (앞에 있을수록 먼저 확인)
const candidates = new Map();
const add = (games) => {
  for (const g of games) if (g.id?.startsWith('igdb-') && !candidates.has(g.id)) candidates.set(g.id, g);
};
add(await igdb.featured(30));
const lists = [['popular'], ['top'], ['recent'], ...GENRES.map((g) => ['popular', g.value])];
for (const [kind, genre] of lists) {
  for (let p = 0; p < (genre ? Math.ceil(PAGES / 2) : PAGES); p++) {
    const { games, hasMore } = await igdb.browse(kind, { genre, offset: p * PAGE, limit: PAGE });
    add(games);
    if (!hasMore) break;
  }
}
const todo = [...candidates.values()].filter((g) => !store.has(g.id) || (RETRY && store.isMiss(g.id))).slice(0, LIMIT);
console.log(`후보 ${candidates.size}개 중 확인할 게임 ${todo.length}개 → RAWG 호출 최대 ${todo.length * 2}건, 예상 약 ${Math.ceil((todo.length * (GAP + 700)) / 60000)}분`);
if (DRY || !todo.length) process.exit(0);

// 2) RAWG 검색 (이름 + 출시 연도로 같은 게임인지 확인 — rawgProvider.matchRawg 규칙)
let found = 0;
let missed = 0;
let stopped = null;
process.on('SIGINT', () => {
  store.save();
  console.log(`\n중단 · 저장함 (찾음 ${found}, 못 찾음 ${missed})`);
  process.exit(130);
});
for (const [i, g] of todo.entries()) {
  try {
    const r = await rawg.lookup({ names: [...(g.altNames || []), g.originalTitle, g.title], releaseDate: g.releaseDate });
    store.set(g.id, r.value, r.reason);
    if (r.value) found++;
    else missed++;
  } catch (e) {
    stopped = `${g.title}: ${e.name === 'TimeoutError' ? '응답 시간 초과' : e.message}`;
    break;
  }
  if ((i + 1) % SAVE_EVERY === 0) {
    store.save();
    console.log(`  ${i + 1}/${todo.length} (찾음 ${found}, 못 찾음 ${missed})`);
  }
  await sleep(GAP);
}
store.save();
console.log(`끝 · 찾음 ${found}개, 못 찾음 ${missed}개 · 파일 전체 ${store.size}개`);
if (stopped) {
  console.log(`RAWG 오류로 멈춤 → ${stopped}\n  RAWG 상태를 확인한 뒤 다시 실행하면 이어서 합니다.`);
  process.exit(1);
}
