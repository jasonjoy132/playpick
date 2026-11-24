// 유료·무료 미리 저장: `npm run prefill:price`
// 스토어 근거를 먼저 쓰고, 스토어가 없는 게임만 AI에게 물어 server/data/price.json 에 저장합니다. 서버는 이 파일만 읽습니다.
//
//   npm run prefill:price                    1) Steam  2) App Store  (키 필요 없음)
//   npm run prefill:price -- --ai            3) 스토어 근거가 없는 IGDB 게임을 AI(Gemini)에게 (GEMINI_API_KEY 필요)
//   npm run prefill:price -- --only steam    steam | appstore | ai 하나만
//   npm run prefill:price -- --only steam-list [--dry] [--recheck]  Steam 상점 목록 전체(가격 포함, 약 7만 개·30분, .cache/steam-prices.json 에 7일 저장)를
//                                            IGDB의 Steam 번호와 맞춰 한 번에 저장('Steam 기준'). AI 값과 다르면 Steam 값으로 바꿈
//   npm run prefill:price -- --pages 10      후보 목록 깊이(목록마다 50개씩 N쪽, 기본 4쪽 = 200위)
//   npm run prefill:price -- --limit 300     Steam·AI 확인 게임 수 상한(기본 1000)
//   npm run prefill:price -- --recheck       이미 확인한 게임도 다시 (가격 정책이 바뀌었을 때)
//   npm run prefill:price -- --dry           개수만
//   npm run prefill:price -- --export        정보 없는 게임(IGDB 인기 후보 + 화면에 보이는 게관위 게임)을 외부 AI용 CSV로
//                                            → server/data/price-review/price-partN.csv(300개씩) + price.map.json, 질문은 PROMPT-PRICE.md
//   npm run prefill:price -- --import <결과.csv...> [--dry] [--force]   외부 AI 답 반영('AI 추정', 스토어 근거는 안 건드림)
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
import path from 'node:path';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createGracProvider } from '../server/providers/gracProvider.js';
import { createPartySize } from '../server/services/partySize.js';
import { createAppArt } from '../server/services/appArt.js';
import { isOffTopic } from '../server/services/taxonomy.js';
import { priceKey } from '../server/services/pricing.js';
import { applyPriceResults, parsePriceResults } from './lib/priceResults.mjs';
import { parseSteamSearch, pickByGame } from './lib/steamSearch.mjs';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
const ONLY = opt('only', null);
const EXPORT = opt('export', false) === true;
const IMPORT = args.includes('--import');
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
const REVIEW_DIR = path.join(path.dirname(config.pricing.dataFile), 'price-review');
const MAP_FILE = path.join(REVIEW_DIR, 'price.map.json');

// 외부 AI 답 반영
if (IMPORT) {
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--only' && args[i - 1] !== '--pages' && args[i - 1] !== '--limit');
  if (!files.length) {
    console.log('사용법: npm run prefill:price -- --import <결과 파일> [더 많은 파일] [--dry] [--force]');
    process.exit(1);
  }
  let idToKey;
  try {
    idToKey = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch {
    console.log(`${MAP_FILE} 이 없어요. 먼저 npm run prefill:price -- --export 로 내보낸 목록이 있어야 해요.`);
    process.exit(1);
  }
  const total = { free: 0, paid: 0, unknown: 0, skipped: 0, badId: 0, badValue: 0 };
  for (const f of files) {
    const { count } = applyPriceResults(store, idToKey, parsePriceResults(fs.readFileSync(f, 'utf8')), { force: args.includes('--force') });
    console.log(`${f}: 무료 ${count.free}, 유료 ${count.paid}, 모름 ${count.unknown}, 건너뜀(이미 있음) ${count.skipped}, 없는 id ${count.badId}, known인데 값 이상 ${count.badValue}`);
    for (const k of Object.keys(total)) total[k] += count[k];
  }
  if (DRY) console.log('--dry: 저장하지 않았어요.');
  else store.save();
  console.log(`합계 무료 ${total.free}, 유료 ${total.paid}, 모름 ${total.unknown}`);
  process.exit(0);
}
// Steam 상점 목록 전체(가격 포함) → IGDB가 Steam 번호로 아는 게임 모두
if (ONLY === 'steam-list') {
  const CACHE = path.join(path.dirname(config.pricing.dataFile), '..', '..', '.cache', 'steam-prices.json');
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
  const cat = readJson(CACHE, { start: 0, total: null, apps: {} });
  const fresh = cat.updatedAt && Date.now() - Date.parse(cat.updatedAt) < 7 * 24 * 60 * 60e3;
  if (RECHECK || (cat.updatedAt && !fresh)) Object.assign(cat, { start: 0, total: null, apps: {}, updatedAt: null });
  if (!cat.updatedAt) {
    console.log(`1) Steam 상점 목록 받기(가격 포함) · ${CACHE} (받은 것 ${Object.keys(cat.apps).length}개, ${cat.start}번째부터, 약 30분)`);
    let fails = 0;
    while (cat.total == null || cat.start < cat.total) {
      try {
        const r = await fetch(`https://store.steampowered.com/search/results/?query&start=${cat.start}&count=100&sort_by=Reviews_DESC&category1=998&infinite=1&cc=kr&l=english`, { headers: { 'User-Agent': 'PlayPick school project (price check)' }, signal: AbortSignal.timeout(20_000) });
        if (r.status === 429) throw new Error('호출 제한');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        cat.total = j.total_count;
        for (const a of parseSteamSearch(j.results_html)) cat.apps[a.id] = { free: a.free, reviews: a.reviews };
        cat.start += 100;
        fails = 0;
        if ((cat.start / 100) % 20 === 0) {
          writeJson(CACHE, cat);
          console.log(`  ${cat.start}/${cat.total} (게임 ${Object.keys(cat.apps).length}개)`);
        }
        await sleep(2500);
      } catch (e) {
        writeJson(CACHE, cat);
        if (++fails >= 5) {
          console.log(`Steam 오류로 멈춤(${e.message}). 다시 실행하면 이어서 받습니다.`);
          process.exit(1);
        }
        console.log(`  오류(${e.message}) → 1분 쉼`);
        await sleep(60_000);
      }
    }
    cat.updatedAt = new Date().toISOString();
    writeJson(CACHE, cat);
  }
  const ids = Object.keys(cat.apps).filter((id) => typeof cat.apps[id].free === 'boolean');
  console.log(`2) IGDB와 맞추기 · Steam 게임 ${Object.keys(cat.apps).length}개 중 무료·유료 확인 ${ids.length}개`);
  const igdb = createIgdbProvider(config.igdb);
  const links = [];
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400).map((id) => `"${id}"`);
    links.push(...(await igdb.query('external_games', `fields uid,game; where external_game_source = 1 & uid = (${part.join(',')}); limit 500;`)));
    if ((i / 400) % 25 === 0) console.log(`  ${i}/${ids.length}`);
  }
  const picked = pickByGame(links, cat.apps);
  let free = 0, paid = 0, kept = 0, changed = 0;
  for (const [key, v] of picked) {
    const old = store.entry(key);
    if (old?.source === 'steam' && !RECHECK) {
      kept++;
      continue;
    }
    if (typeof old?.free === 'boolean' && old.free !== v.free) changed++;
    if (!DRY) store.set(key, v.free, 'steam', { appid: v.appid, via: 'search' });
    v.free ? free++ : paid++;
  }
  if (!DRY) store.save();
  console.log(`끝 · IGDB 게임 ${picked.size}개: 새로 무료 ${free}, 유료 ${paid} (이미 Steam 근거 ${kept}, AI 값과 달라 바꾼 것 ${changed})${DRY ? ' · --dry: 저장 안 함' : ''}`);
  process.exit(0);
}

console.log(`유료·무료 미리 저장 · ${config.pricing.dataFile} (저장 ${store.size}개) · 할 일: ${[...STEPS].join(', ')}`);
process.on('SIGINT', () => {
  store.save();
  console.log('\n중단 · 저장함');
  process.exit(130);
});

// 후보: IGDB 인기 목록 (Steam·AI 단계에만 필요)
let candidates = [];
if (STEPS.has('steam') || STEPS.has('ai') || EXPORT) {
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

// 외부 AI용 내보내기: 아직 유료·무료를 모르는 게임만 (스토어 근거·AI 값이 있으면 뺌, 출시 전 Steam 게임도 뺌)
if (EXPORT) {
  // 이미 외부 AI가 '모름'이라 한 게임은 다시 내보내지 않음
  const unknown = (key) => typeof store.entry(key)?.free !== 'boolean' && store.entry(key)?.via !== 'external';
  const list = [];
  const seen = new Set();
  const add = (g, kind) => {
    const key = priceKey(g);
    if (!key || seen.has(key) || !unknown(key)) return;
    seen.add(key);
    list.push({ key, kind, g });
  };
  for (const g of candidates) add(g, 'igdb'); // Steam 주소가 있어도 Steam 목록에서 못 찾은 게임(판매 중단 등)은 포함
  // 화면에 보이는 게관위 게임 (prefill:players --grac-players 와 같은 기준)
  const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed, log: () => {} });
  let snap = index.snapshot();
  if (snap.status !== 'ready') {
    await index.ensure();
    snap = index.snapshot();
  }
  let exists = {};
  try {
    exists = JSON.parse(fs.readFileSync(config.grac.igdbCheckFile, 'utf8'));
  } catch {
    /* 없음 */
  }
  const ps = createPartySize({ ...config.gemini, live: false }, { log: () => {} });
  const art = createAppArt(config.appStore.artFile);
  const visible = art
    .applyAll(ps.applyCached((snap.games ?? []).filter((g) => !exists[g.title]?.exists)))
    .filter((g) => !g.aiEnded && !g.aiUpcoming && !isOffTopic(g) && (g.aiAlive || g.appStoreUrl))
    .sort((a, b) => String(b.ratingDate || '').localeCompare(String(a.ratingDate || '')));
  for (const g of visible) add(g, 'grac');
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  for (const f of fs.readdirSync(REVIEW_DIR)) if (/^price-part\d+\.csv$|^price\.map\.json$/.test(f)) fs.rmSync(path.join(REVIEW_DIR, f));
  const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const head = 'id,title,original_title,publisher,platform,genre,year,source,store_url';
  const row = ({ g, kind }, i) =>
    [i + 1, g.title, g.originalTitle, g.publisher, g.platformsRaw, g.genresRaw, g.releaseDate?.slice(0, 4) ?? g.ratingDate?.slice(0, 4), kind === 'igdb' ? 'IGDB' : '게임물관리위원회(한국)', (g.stores ?? [])[0]?.url ?? g.appStoreUrl]
      .map(cell)
      .join(',');
  const N = Math.max(Number(opt('part', 300)), 50);
  fs.writeFileSync(MAP_FILE, JSON.stringify(Object.fromEntries(list.map((x, i) => [i + 1, x.key]))));
  for (let i = 0; i < list.length; i += N) fs.writeFileSync(path.join(REVIEW_DIR, `price-part${i / N + 1}.csv`), `﻿${[head, ...list.slice(i, i + N).map((x, k) => row(x, i + k))].join('\n')}\n`);
  console.log(`📄 정보 없는 게임 ${list.length}개(IGDB ${list.filter((x) => x.kind === 'igdb').length}, 게관위 ${list.filter((x) => x.kind === 'grac').length}) → ${path.join(REVIEW_DIR, 'price-part1')}~${Math.ceil(list.length / N)}.csv (${N}개씩) + price.map.json`);
  console.log('   PROMPT-PRICE.md 질문과 함께 외부 AI(웹 검색 켜기)에 주고, 답은 npm run prefill:price -- --import <결과.csv> --dry 로 먼저 확인하세요.');
  process.exit(0);
}

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
