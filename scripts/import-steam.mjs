// IGDB·게관위에 없는 Steam 게임 찾아 넣기: `npm run import:steam`
//
//   npm run import:steam -- --crawl            1) Steam 상점 검색으로 게임 전체 목록 받기 → .cache/steam-catalog.json (약 7만 개, 15분, 이어서 가능)
//   npm run import:steam                       2) 리뷰 많은 게임 중 IGDB·게관위에 없는 게임을 찾아 3) Steam 상세 정보 저장 → server/data/steam-games.json
//   npm run import:steam -- --min 300          리뷰 수 하한(기본 200, 하는 사람이 거의 없는 게임은 넣지 않음)
//   npm run import:steam -- --dry              빠진 게임 수·예시만
//   npm run import:steam -- --recheck          이미 저장·제외한 게임도 다시
//
// - '빠졌다'는 판단: IGDB가 그 Steam 번호를 모름(external_games) + IGDB에 같은 이름 없음 + 게관위 색인에 같은 이름 없음
// - 넣지 않는 것: 게임이 아닌 프로그램·영상(type), 출시 전, 성인 전용(Steam 성인 콘텐츠 표시 3·4)
// - 저장하는 값은 Steam이 준 것만(이름·소개·장르·기능·플랫폼·출시일·개발사·무료 여부·그림). 세로 표지는 주소가 실제로 열릴 때만
// - 추천 인원: Steam 기능이 '싱글 플레이'뿐이면 1명, 멀티 기능이 있으면 인원 수를 몰라 '정보 없음'
// - 결과 파일은 git으로 배포(서버는 읽기만). 서버가 켜져 있으면 30초 안에 반영
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createIgdbProvider, normTitle, titleVariants } from '../server/providers/igdbProvider.js';
import { createSteamGames, steamToGame } from '../server/services/steamGames.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
const CRAWL = opt('crawl', false) === true;
const MIN = Number(opt('min', 200));
const DRY = opt('dry', false) === true;
const RECHECK = opt('recheck', false) === true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const config = getConfig();
const ROOT = path.resolve(path.dirname(config.pricing.dataFile), '..', '..');
const CATALOG = path.join(ROOT, '.cache', 'steam-catalog.json');
const UA = { 'User-Agent': 'PlayPick school project (catalog check)' };

const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v));
  fs.renameSync(`${f}.tmp`, f);
};
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// 1) Steam 상점 검색: 게임만(category1=998), 100개씩
if (CRAWL) {
  const cat = readJson(CATALOG, { start: 0, total: null, apps: {} });
  if (RECHECK) Object.assign(cat, { start: 0, apps: {} });
  console.log(`Steam 목록 받기 · ${CATALOG} (받은 것 ${Object.keys(cat.apps).length}개, ${cat.start}번째부터)`);
  let fails = 0;
  while (cat.total == null || cat.start < cat.total) {
    try {
      const r = await fetch(`https://store.steampowered.com/search/results/?query&start=${cat.start}&count=100&sort_by=Reviews_DESC&category1=998&infinite=1&cc=kr&l=english`, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (r.status === 429) throw new Error('호출 제한');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      cat.total = j.total_count;
      const rows = String(j.results_html).split('<a href=').slice(1);
      for (const row of rows) {
        const id = row.match(/data-ds-appid="(\d+)"/)?.[1]; // 묶음 상품(번호 여러 개)은 빼고
        const name = row.match(/<span class="title">([^<]*)<\/span>/)?.[1];
        if (!id || !name) continue;
        const reviews = Number(decode(row.match(/data-tooltip-html="([^"]*)"/)?.[1] ?? '').match(/of the ([\d,]+) user reviews/)?.[1]?.replace(/,/g, '') ?? 0);
        cat.apps[id] = { name: decode(name), reviews };
      }
      cat.start += 100;
      fails = 0;
      if ((cat.start / 100) % 20 === 0) {
        writeJson(CATALOG, cat);
        console.log(`  ${cat.start}/${cat.total} (게임 ${Object.keys(cat.apps).length}개)`);
      }
      await sleep(2500);
    } catch (e) {
      writeJson(CATALOG, cat);
      if (++fails >= 5) {
        console.log(`Steam 오류로 멈춤(${e.message}). 다시 실행하면 이어서 받습니다.`);
        process.exit(1);
      }
      console.log(`  오류(${e.message}) → 1분 쉼`);
      await sleep(60_000);
    }
  }
  cat.updatedAt = new Date().toISOString();
  writeJson(CATALOG, cat);
  console.log(`끝 · 게임 ${Object.keys(cat.apps).length}개`);
  process.exit(0);
}

// 2) 빠진 게임 찾기
const cat = readJson(CATALOG, null);
if (!cat?.apps) {
  console.log('Steam 목록이 없어요. 먼저 npm run import:steam -- --crawl');
  process.exit(1);
}
const store = createSteamGames(config.steamGames.dataFile);
const popular = Object.entries(cat.apps).filter(([, a]) => a.reviews >= MIN).sort((a, b) => b[1].reviews - a[1].reviews);
console.log(`Steam 게임 ${Object.keys(cat.apps).length}개 중 리뷰 ${MIN}개 이상 ${popular.length}개`);
const igdb = createIgdbProvider(config.igdb);
const known = new Set();
for (let i = 0; i < popular.length; i += 400) {
  const part = popular.slice(i, i + 400).map(([id]) => `"${id}"`);
  const rows = await igdb.query('external_games', `fields uid; where external_game_source = 1 & uid = (${part.join(',')}); limit 500;`);
  for (const r of rows) known.add(String(r.uid));
}
let missing = popular.filter(([id]) => !known.has(id));
console.log(`  IGDB가 Steam 번호로 아는 게임 ${known.size}개 · 모르는 게임 ${missing.length}개`);
const igdbNames = new Set();
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const clean = (s) => String(s).replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim(); // 'Call of Duty®' → 'Call of Duty'
for (let i = 0; i < missing.length; i += 50) {
  const names = [...new Set(missing.slice(i, i + 50).flatMap(([, a]) => [a.name, clean(a.name)]))];
  const rows = await igdb.query('games', `fields name; where name = (${names.map(q).join(',')}); limit 500;`).catch(() => []);
  for (const r of rows) igdbNames.add(normTitle(r.name));
}
missing = missing.filter(([, a]) => !igdbNames.has(normTitle(a.name)));
// IGDB 검색으로 한 번 더: 지역판·판 이름이 붙은 Steam 이름('Tree of Savior (English Ver.)')도 괄호·판 표기를 떼고 같으면 IGDB에 있는 게임
const keysOf = (s) => new Set(titleVariants(clean(s)).map(normTitle).filter((k) => k.length >= 4));
const stillMissing = [];
for (const [id, a] of missing) {
  const rows = await igdb.query('games', `search ${q(clean(a.name).replace(/[([].*$/, '').trim() || clean(a.name))}; fields name,alternative_names.name; limit 5;`).catch(() => []);
  const mine = keysOf(a.name);
  const hit = rows.some((r) => [r.name, ...(r.alternative_names ?? []).map((x) => x.name)].some((n) => [...keysOf(n)].some((k) => mine.has(k))));
  if (!hit) stillMissing.push([id, a]);
}
console.log(`  IGDB 검색으로 찾은 게임 ${missing.length - stillMissing.length}개`);
missing = stillMissing;
const grac = readJson(config.grac?.indexSeed ?? path.join(ROOT, 'server', 'data', 'grac-index.json'), { games: [] }).games ?? [];
const gracKeys = new Set(grac.flatMap((g) => titleVariants(g.title).map(normTitle)));
missing = missing.filter(([, a]) => !gracKeys.has(normTitle(a.name)));
console.log(`  이름까지 봐도 IGDB·게관위에 없는 게임 ${missing.length}개`);
for (const [id, a] of missing.slice(0, 15)) console.log(`    ${a.name} (${id}, 리뷰 ${a.reviews})`);
if (DRY) process.exit(0);

// 3) Steam 상세 정보 (한국어로)
if (RECHECK) store.clear(); // 이번에 빠진 게임으로 처음부터 (IGDB에 새로 생긴 게임은 빠짐)
const todo = missing.filter(([id]) => RECHECK || !store.has(id));
console.log(`Steam 상세 정보 받기 ${todo.length}개 (약 ${Math.ceil((todo.length * 2) / 60)}분)`);
let added = 0;
const skipped = {};
for (const [i, [id, a]] of todo.entries()) {
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=kr&l=koreana`, { headers: UA, signal: AbortSignal.timeout(15_000) });
    if (r.status === 429 || r.status === 403) {
      console.log('  Steam 호출 제한 → 5분 쉼');
      await sleep(5 * 60e3);
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json())?.[id];
    let cover = null;
    const portrait = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;
    if (d?.success) cover = (await fetch(portrait, { method: 'HEAD', headers: UA }).catch(() => null))?.ok ? portrait : null; // 실제로 열릴 때만
    const res = steamToGame(id, d, { englishName: a.name, reviews: a.reviews, cover });
    if (res.game) {
      store.set(id, { game: res.game });
      added++;
    } else {
      store.set(id, { skip: res.skip });
      skipped[res.skip] = (skipped[res.skip] ?? 0) + 1;
    }
  } catch (e) {
    console.log(`  ${a.name}: ${e.message}`);
  }
  if ((i + 1) % 25 === 0) {
    store.save();
    console.log(`  ${i + 1}/${todo.length} (넣음 ${added})`);
  }
  await sleep(1600);
}
store.save();
console.log(`끝 · 넣음 ${added}개 · 뺌 ${JSON.stringify(skipped)} · 파일의 게임 ${store.games().length}개`);
