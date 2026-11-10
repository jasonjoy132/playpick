// 추천 인원·플레이 시간 미리 정리하기: `npm run prefill:players`
// IGDB 인기 게임(과 선택하면 게임위 게임)을 Gemini에게 묶어서 묻고 (추천 인원 + 메인 스토리 플레이 시간)
// - 추천 인원은 IGDB로 정할 수 없는 게임에만, 플레이 시간은 RAWG에 없을 때만 화면에 쓰입니다.
// server/data/party-size.json 에 저장합니다. 서버는 검색할 때 AI를 부르지 않고 이 파일만 읽습니다.
//
//   npm run prefill:players                       IGDB 인기 게임 3000개 훑기
//   npm run prefill:players -- --igdb 10000       더 많이
//   npm run prefill:players -- --grac 2000        게임위 게임(최신 등급분류 순) 2000개도 (출시 예정/출시/종료도 AI 판단 → 종료면 숨김, 출시 예정이면 '출시 예정' 목록에)
//   (IGDB 게임 중 온라인 서버가 필요한 게임(MMO·배틀로얄·멀티 전용)은 서비스 종료 여부도 함께 묻고, 종료면 숨김)
//   npm run prefill:players -- --recheck          게임위 게임 서비스 상태 엄격 재확인: 예전에 '서비스 중'으로 받은 게임을 다시 물어
//                                                 확실히 아는 게임만 '서비스 중'으로 남김(모르면 목록에서 숨김). 인원·플레이 시간은 그대로
//   npm run prefill:players -- --recheck --model gemini-flash-latest   더 큰 모델로(더 정확, 한도는 더 적음)
//   npm run prefill:players -- --recheck-unknown  게임위 게임 중 AI가 '모름'이라고 한 게임만 더 큰 모델(기본 gemini-flash-latest)로 다시 물음
//                                                 (같은 모델로 이미 물어본 게임은 건너뜀. --model 로 다른 모델 지정 가능)
//   npm run prefill:players -- --grac-players 500 화면에 보이는 게임위 게임 중 추천 인원을 아직 안 물은 게임 500개(숫자 없으면 전부)에 인원만 물음
//                                                 (서비스 상태·플레이 시간은 그대로 두고 인원만 더함. AI가 모르면 '모름'으로 저장해 다시 묻지 않음)
//   npm run prefill:players -- --grac-players --export   AI에게 묻지 않고 대상 목록을 server/data/players-review/ 에 CSV(300개씩)로 내보내기(외부 AI용)
//   npm run prefill:players -- --dry              묻지 않고 몇 개인지만 계산
//   npm run prefill:players -- --rpm 30           더 빠르게(분당 호출 수 상한, 기본 15. 한도를 넘으면 429 → 자동으로 1분 쉼)
//   npm run prefill:players -- --parallel 5       동시에 보내는 묶음 수(기본 3)
//
// - 이미 정리된 게임은 건너뛰므로 중간에 꺼도(Ctrl+C) 다시 실행하면 이어서 합니다.
// - 무료 사용량을 넘으면(429) 1분씩 3번 기다려 보고, 그래도 안 되면 멈춥니다(내일 다시 실행).
// - 키는 .env 에서만 읽고 로그에 남기지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createIgdbProvider } from '../server/providers/igdbProvider.js';
import { createGracProvider } from '../server/providers/gracProvider.js';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createPartySize, cacheKey } from '../server/services/partySize.js';
import { createExistenceCache } from '../server/services/catalog.js';
import { createAppArt } from '../server/services/appArt.js';
import { isOffTopic } from '../server/services/taxonomy.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
// --grac-players: 화면에 보이는 게임위 게임 중 추천 인원을 아직 안 물은 게임만 인원만 물음(상태·플레이 시간은 그대로)
const GRAC_PLAYERS_N = opt('grac-players', 0) === true ? Infinity : Number(opt('grac-players', 0));
const PLAYERS_ONLY = GRAC_PLAYERS_N > 0;
// --grac 만 주면 IGDB 게임은 훑지 않음(이미 정리했다면 할 필요 없음)
const IGDB_N = opt('igdb', opt('grac', 0) > 0 || PLAYERS_ONLY ? 0 : 3000);
const GRAC_N = PLAYERS_ONLY ? 0 : opt('grac', 0);
const MIN_RATINGS = opt('min-ratings', 1);
// 한 번에 묻는 게임 수. 게임위만 정리할 때는 하루 호출 수를 아끼려고 100개씩
const BATCH = Math.min(Math.max(opt('batch', args.includes('--recheck-unknown') || args.includes('--model') ? 20 : (opt('grac', 0) > 0 && !args.includes('--igdb')) || args.includes('--recheck') || PLAYERS_ONLY ? 100 : 50), 5), 100);
// 속도: 여러 묶음을 동시에(--parallel) 보내되, 분당 호출 수(--rpm)를 넘지 않게. 429가 나면 모두 1분 쉼
// 큰 모델('모름' 재확인)은 무료 분당 한도가 작아 천천히(기본 동시 1개, 분당 5번)
const BIG = args.includes('--recheck-unknown') || args.includes('--model');
const PARALLEL = Math.min(Math.max(opt('parallel', BIG ? 2 : 3), 1), 10);
const RPM = Math.max(opt('rpm', opt('interval', null) ? Math.round(60000 / opt('interval', 4000)) : BIG ? 5 : 15), 1);
const DRY = opt('dry', false) === true;
const EXPORT = opt('export', false) === true; // --grac-players --export: AI에게 묻지 않고 외부 AI용 CSV로 내보내기
const UNKNOWN = opt('recheck-unknown', false) === true;
const RECHECK = opt('recheck', false) === true || UNKNOWN;
const MODEL = typeof opt('model', null) === 'string' ? opt('model', null) : UNKNOWN ? 'gemini-flash-latest' : null;

const config = getConfig();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 응답 기다리는 시간: 기본 60초, 큰 모델('모름' 재확인·--model 지정)은 느려서 3분 (--timeout 초로 바꿀 수 있음)
const TIMEOUT_MS = Math.max(Number(opt('timeout', BIG || MODEL ? 180 : 60)), 10) * 1000;
const ps = createPartySize({ ...config.gemini, ...(MODEL ? { model: MODEL } : {}), timeoutMs: TIMEOUT_MS, live: false }, { log: (m) => console.log(m) });
const needs = (g) => (PLAYERS_ONLY ? ps.needsPlayers(g) : UNKNOWN ? ps.needsUnknownRecheck(g) : RECHECK ? ps.needsStatusRecheck(g) : ps.needsPrefill(g));

console.log(`추천 인원·플레이 시간 미리 정리 · 모델 ${ps.model} · 저장 파일 ${config.gemini.dataFile}`);
console.log(`이미 정리된 게임 ${ps.size}개`);
if (!ps.configured && !DRY && !EXPORT) {
  console.log('❌ .env 에 GEMINI_API_KEY 가 없습니다. (--dry 로 개수만 볼 수는 있어요)');
  process.exit(1);
}

// 1) IGDB 인기 게임 중 AI가 필요한 것
const todo = [];
const igdb = createIgdbProvider(config.igdb ?? {});
// 0) (--recheck) 화면에 보이는 게임위 게임 중 예전 기준 '서비스 중' → 엄격하게 다시 확인 (App Store에 있는 게임은 그대로 보이므로 제외)
if (RECHECK) {
  const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed, log: (m) => console.log(m) });
  let snap = index.snapshot();
  if (snap.status !== 'ready') {
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
  const art = createAppArt(config.appStore.artFile);
  const seen = new Set();
  for (const g of snap.games) {
    if (exists[g.title]?.exists || seen.has(cacheKey(g))) continue;
    seen.add(cacheKey(g));
    if (needs(g) && !art.apply(g).appStoreUrl) todo.push(g);
  }
  console.log(UNKNOWN
    ? `게임위 '모름' 재확인 대상 ${todo.length}개 (모델 ${ps.model}로 아직 안 물어본 게임, App Store에 있는 게임 제외)`
    : `게임위 상태 재확인 대상 ${todo.length}개 (예전에 '서비스 중'으로 받은 게임, App Store에 있는 게임 제외)`);
}
// 0-2) (--grac-players) 화면에 보이는 게임위 게임(IGDB에 없음, 종료·출시 예정 아님, AI '서비스 중' 또는 App Store에 있음) 중 인원 답이 없는 게임
if (PLAYERS_ONLY) {
  const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed, log: (m) => console.log(m) });
  let snap = index.snapshot();
  if (snap.status !== 'ready') {
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
  const art = createAppArt(config.appStore.artFile);
  const seen = new Set();
  const visible = art
    .applyAll(ps.applyCached(snap.games.filter((g) => !exists[g.title]?.exists)))
    .filter((g) => !g.aiEnded && !g.aiUpcoming && !isOffTopic(g) && (g.aiAlive || g.appStoreUrl))
    .sort((a, b) => String(b.ratingDate || '').localeCompare(String(a.ratingDate || '')));
  for (const g of visible) {
    if (seen.has(cacheKey(g))) continue;
    seen.add(cacheKey(g));
    if (ps.needsPlayers(g)) todo.push(g);
  }
  todo.splice(GRAC_PLAYERS_N);
  console.log(`화면에 보이는 게임위 게임 ${visible.length}개 중 추천 인원을 물을 게임 ${todo.length}개 (인원만 묻고 서비스 상태·플레이 시간은 그대로)`);
  if (EXPORT) {
    // 외부 AI용 CSV (300개씩) + id → 게임 연결 파일. 받은 답은 npm run import:players 로 반영
    const dir = path.join(path.dirname(config.gemini.dataFile), 'players-review');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (/^players(-part\d+)?\.csv$|^players\.map\.json$/.test(f)) fs.rmSync(path.join(dir, f));
    const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    const head = 'id,title,publisher,platform,genre,rating_date,app_store_url';
    const row = (g, i) => [i + 1, g.title, g.publisher, g.platformsRaw, g.genresRaw, g.ratingDate, g.appStoreUrl].map(cell).join(',');
    const N = Math.max(Number(opt('part', 300)), 50);
    const map = Object.fromEntries(todo.map((g, i) => [i + 1, cacheKey(g)]));
    fs.writeFileSync(path.join(dir, 'players.map.json'), JSON.stringify(map));
    const write = (file, from, to) => fs.writeFileSync(path.join(dir, file), `﻿${[head, ...todo.slice(from, to).map((g, k) => row(g, from + k))].join('\n')}\n`);
    for (let i = 0; i < todo.length; i += N) write(`players-part${i / N + 1}.csv`, i, i + N);
    console.log(`📄 ${todo.length}개를 ${dir} 에 내보냈어요: players-part1~${Math.ceil(todo.length / N)}.csv (${N}개씩) + players.map.json`);
    console.log('   PROMPT-PLAYERS.md 의 질문과 함께 외부 AI(웹 검색 켜기)에 주고, 받은 답은 npm run import:players -- <결과 파일> --dry 로 먼저 확인하세요.');
    process.exit(0);
  }
}
if (IGDB_N > 0 && !RECHECK) {
  if (!igdb.configured) console.log('IGDB 설정이 없어 IGDB 게임은 건너뜀');
  else {
    let scanned = 0;
    let total = null;
    let dropped = 0;
    for (let offset = 0; scanned < IGDB_N; offset += 500) {
      const r = await igdb.listPopular({ offset, limit: Math.min(500, IGDB_N - scanned), minRatings: MIN_RATINGS });
      total ??= r.total;
      scanned += r.rows;
      for (const g of r.games) {
        if (ps.dropAiPlayers(g)) dropped++; // IGDB에 추천 인원이 있으면 AI 인원은 필요 없음
        if (ps.needsPrefill(g)) todo.push(g);
      }
      process.stdout.write(`\rIGDB 훑는 중 ${scanned}/${Math.min(IGDB_N, total ?? IGDB_N)} · AI 필요 ${todo.length}개   `);
      if (r.rows < 500) break;
    }
    if (dropped) {
      ps.save();
      console.log(`\nIGDB에 추천 인원이 있는 게임 ${dropped}개에서 예전에 저장한 AI 인원을 지웠어요(플레이 시간은 유지).`);
    }
    const needPlayers = todo.filter((g) => g.recommendedPlayers == null).length;
    console.log(`\n정리 대상 중 추천 인원까지 AI가 필요한 게임 ${needPlayers}개, 플레이 시간만 필요한 게임 ${todo.length - needPlayers}개`);
    console.log(`IGDB: 평가 ${MIN_RATINGS}개 이상 게임 전체 ${total ?? '?'}개 중 ${scanned}개를 훑음 → 아직 정리 안 된 정리 대상 ${todo.length}개`);
  }
}

// 2) (선택) 게임위 게임
if (GRAC_N > 0 && !RECHECK) {
  const grac = createGracProvider(config.grac);
  const index = createGracIndex({ grac, cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed, log: (m) => console.log(m) });
  let snap = index.snapshot();
  if (snap.status !== 'ready') {
    console.log('게임위 전체 목록을 받는 중… (처음 한 번 몇 분)');
    await index.ensure();
    snap = index.snapshot();
  }
  if (snap.status !== 'ready') console.log(`게임위 목록을 받지 못해 건너뜀 (${snap.error ?? ''})`);
  else {
    // 화면에 보이는 게임위 게임 = IGDB에 없는 게임만 정리 (IGDB에 있는 게임은 IGDB 카드로 보이므로 할 필요 없음)
    // IGDB에 있는지는 IGDB 이름·별칭·한국어명 정확 일치로 확인(Gemini 사용량과 무관), 결과는 사이트와 같은 캐시에 저장
    const seen = new Set();
    const candidates = [...snap.games]
      .sort((a, b) => String(b.ratingDate || '').localeCompare(String(a.ratingDate || '')))
      .filter((g) => ps.needsPrefill(g) && !seen.has(cacheKey(g)) && seen.add(cacheKey(g)))
      .slice(0, GRAC_N);
    const check = createExistenceCache(config.grac.igdbCheckFile, config.grac.igdbCheckSeed);
    const inIgdb = new Set();
    if (igdb.configured) {
      const chunks = [];
      for (let k = 0; k < candidates.length; k += 12) chunks.push(candidates.slice(k, k + 12));
      let done = 0;
      let next = 0;
      const worker = async () => {
        while (next < chunks.length) {
          const c = chunks[next++];
          try {
            const raw = new Map(c.map((g) => [g.title, g.platformsRaw]));
            const found = await check.check(c.map((g) => g.title), (names) => igdb.findTitleGames(names), { platformsOf: (t) => raw.get(t) });
            found.forEach((t) => inIgdb.add(t));
          } catch (e) {
            console.log(`\n⚠ IGDB 확인 실패(이 묶음은 IGDB에 없는 것으로 보고 진행): ${e.message}`);
          }
          done++;
          if (done % 20 === 0 || done === chunks.length) {
            check.save();
            process.stdout.write(`\rIGDB에 있는지 확인 중 ${Math.min(done * 12, candidates.length)}/${candidates.length} · IGDB에 있음 ${inIgdb.size}개   `);
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      check.save();
      console.log('');
    } else console.log('IGDB 설정이 없어 IGDB에 있는지 확인하지 못함 → 모두 정리 대상');
    const list = candidates.filter((g) => !inIgdb.has(g.title));
    todo.push(...list);
    console.log(`게임위: 제목 기준 ${snap.games.length}개 중 정리 안 된 ${candidates.length}개 → IGDB에 있어 건너뜀 ${inIgdb.size}개 → 화면에 보이는 게임 ${list.length}개를 정리`);
  }
}

const calls = Math.ceil(todo.length / BATCH);
const perMin = Math.min(RPM, PARALLEL * 15); // 한 번 호출이 약 4초 → 동시 1개당 분당 15번 정도
console.log(`\n물어볼 게임 ${todo.length}개 → ${BATCH}개씩 ${calls}번 호출, 동시 ${PARALLEL}개 · 분당 최대 ${RPM}번 → 예상 약 ${Math.ceil(calls / perMin)}분`);
if (DRY || !todo.length) {
  console.log(DRY ? '(--dry: 묻지 않고 끝)' : '정리할 게임이 없습니다.');
  process.exit(0);
}

// 3) 묶어서 묻고 저장 (동시에 여러 묶음)
let known = 0;
let unknown = 0;
let hoursKnown = 0;
let endedCount = 0;
let upcomingCount = 0;
let finished = 0;
let next = 0;
let stop = false;
let pausedUntil = 0;
let quotaHits = 0;
let busyHits = 0;
let lastStart = 0;
const gap = 60_000 / RPM;
const t0 = Date.now();

async function rateSlot() {
  for (;;) {
    const now = Date.now();
    if (now < pausedUntil) {
      await sleep(pausedUntil - now);
      continue;
    }
    const wait = lastStart + gap - now;
    if (wait <= 0) {
      lastStart = now;
      return;
    }
    await sleep(wait);
  }
}

async function worker() {
  while (!stop && next < calls) {
    const i = next++;
    const batch = todo.slice(i * BATCH, (i + 1) * BATCH).filter(needs);
    if (!batch.length) continue;
    for (let attempt = 1; !stop; attempt++) {
      await rateSlot();
      if (stop) return;
      try {
        const r = PLAYERS_ONLY ? await ps.askPlayersBatch(batch) : RECHECK ? await ps.askStatusBatch(batch) : await ps.askBatch(batch);
        if (PLAYERS_ONLY) {
          known += r.known;
          unknown += r.unknown;
        } else if (RECHECK) {
          known += r.status.released;
          unknown += r.status.unknown;
        } else {
          known += r.known;
          unknown += r.unknown;
          hoursKnown += r.hoursKnown;
        }
        endedCount += r.endedCount ?? 0;
        upcomingCount += r.upcomingCount ?? 0;
        quotaHits = 0;
        busyHits = 0;
        break;
      } catch (e) {
        if (e.code === 'GEMINI_QUOTA') {
          quotaHits++;
          if (quotaHits > 3 * PARALLEL) {
            stop = true;
            console.log(`\n⛔ 사용량 한도에 계속 걸려 멈춥니다. 한도가 풀린 뒤(분당 한도면 잠시 뒤, 하루 한도면 다음 날) 같은 명령을 다시 실행하면 이어서 합니다. --rpm 을 낮추면 덜 걸려요.`);
            return;
          }
          if (e.perDay) {
            stop = true;
            console.log(`\n⛔ 오늘 쓸 수 있는 Gemini 호출 수(하루 한도)를 다 썼어요. (${e.message})`);
            console.log('   지금까지 받은 결과는 저장돼 있어요. 한도가 초기화된 뒤(보통 한국 시간 오후 4~5시) 같은 명령을 다시 실행하면 이어서 합니다.');
            console.log('   더 빨리 하려면: .env 의 GEMINI_MODEL 을 다른 Lite 모델(예: gemini-3.1-flash-lite)로 바꾸면 그 모델의 한도를 따로 씁니다.');
            return;
          }
          if (Date.now() >= pausedUntil) console.log(`⏳ 사용량 한도(429) — 모두 1분 쉬었다 다시 · ${e.message}${quotaHits === 1 && e.detail ? `\n   ${e.detail}` : ''}`);
          pausedUntil = Math.max(pausedUntil, Date.now() + (process.env.PREFILL_PAUSE_MS ? Number(process.env.PREFILL_PAUSE_MS) : 60_000));
        } else if (e.code === 'GEMINI_BUSY' || e.code === 'GEMINI_NETWORK') {
          // 붐빔·연결 끊김: 모두 잠깐 쉬고(15초→30초→1분→2분→4분) 다시. 계속되면 이 묶음은 다음 실행으로
          busyHits++;
          if (attempt > 5) {
            console.log(`⚠ ${e.message} — 계속 붐벼서 이 묶음은 건너뜀(다음 실행 때 다시)`);
            break;
          }
          const wait = Math.min(15_000 * 2 ** (attempt - 1), 240_000) * (process.env.PREFILL_PAUSE_MS ? 0.001 : 1);
          if (Date.now() >= pausedUntil) console.log(`⏳ ${e.message} — 모두 ${Math.round(wait / 1000)}초 쉬었다 다시`);
          pausedUntil = Math.max(pausedUntil, Date.now() + wait);
          if (busyHits >= 6 * PARALLEL) {
            stop = true;
            console.log('\n⛔ Gemini 서버가 계속 붐벼서 멈춥니다. 저장된 결과는 그대로예요. 잠시 뒤 같은 명령을 다시 실행하거나, .env 의 GEMINI_MODEL 을 다른 Lite 모델(예: gemini-3.1-flash-lite)로 바꿔 보세요.');
            return;
          }
        } else if (attempt <= 2) {
          console.log(`⚠ ${e.message} — 다시 시도`);
          await sleep(5000);
        } else {
          console.log(`⚠ ${e.message} — 이 묶음은 건너뜀(다음 실행 때 다시)`);
          break;
        }
      }
    }
    finished++;
    const elapsed = (Date.now() - t0) / 1000;
    const left = Math.round(((elapsed / finished) * (calls - finished)) / 60);
    if (RECHECK) console.log(`[${finished}/${calls}] 누적: 서비스 중 ${known}개 · 종료 ${endedCount}개 · 출시 예정 ${upcomingCount}개 · 모름(목록에서 숨김) ${unknown}개 · 남은 시간 약 ${left}분`);
    else console.log(`[${finished}/${calls}] 누적: 추천 인원 ${known}개 · 플레이 시간 ${hoursKnown}개 확인 (인원 모름 ${unknown}개)${endedCount ? ` · 서비스 종료 판단 ${endedCount}개` : ''}${upcomingCount ? ` · 출시 예정 ${upcomingCount}개` : ''} · 남은 시간 약 ${left}분`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
if (stop) process.exit(0);
if (RECHECK) {
  console.log(`\n✅ 끝: 서비스 중 ${known}개(목록에 보임), 종료 ${endedCount}개 · 모름 ${unknown}개(목록에서 숨김), 출시 예정 ${upcomingCount}개(출시 예정 목록에) → ${config.gemini.dataFile}`);
  console.log('서버가 켜져 있으면 30초 안에 자동으로 다시 읽습니다.');
  process.exit(0);
}
console.log(`\n✅ 끝: 추천 인원 ${known}개, 플레이 시간 ${hoursKnown}개 확인 (인원 모름 ${unknown}개)${endedCount ? `, 서비스 종료 판단 ${endedCount}개(목록에서 숨김)` : ''}${upcomingCount ? `, 게임위 출시 예정 ${upcomingCount}개(출시 예정 목록에)` : ''} → ${config.gemini.dataFile} (전체 ${ps.size}개)`);
console.log('서버가 켜져 있으면 30초 안에 자동으로 다시 읽습니다.');
