// IGDB 게임 서비스 종료 확인: `npm run prefill:ended`
// IGDB에는 '서비스 종료(Offline)' 표시가 안 된 게임이 많아서(예: 넥슨 버블파이터), AI에게 서비스 종료 여부를 물어
// 확실히 종료된 게임만 목록·검색에서 숨깁니다(상세 페이지는 그대로). 결과는 server/data/party-size.json 에 함께 저장.
//
//   npm run prefill:ended                          아래 세 가지 대상을 모두
//      ① 게임위 등급을 받은 IGDB 게임(국내에 나온 게임 — 국내 온라인 게임이 많음, 모드 정보가 없어도 모두)
//      ② IGDB 인기 게임 중 멀티·협동·MMO·배틀로얄 모드가 있는 게임 (--igdb N, 기본 30000개 훑기)
//      ③ 평가가 없어도 PC·모바일·웹 온라인 게임 (--online N, 기본 0 — 많으면 수만 개라 원할 때만)
//   npm run prefill:ended -- --dry                 묻지 않고 개수만
//   (한 번 훑은 IGDB 후보는 .cache/ended-candidates.json 에 저장 → 같은 옵션으로 24시간 안에 다시 실행하면 바로 이어서 묻기)
//   npm run prefill:ended -- --rescan              저장한 후보를 무시하고 IGDB를 다시 훑기
//   npm run prefill:ended -- --export              AI에게 묻지 않고 대상 목록을 CSV로 내보내기(외부 AI용)
//      → server/data/status-review/ended-games-partN.csv (200개씩) + PROMPT-ENDED.md 참고
//      → 받은 답은 npm run import:status -- <결과 파일> 로 반영
//   npm run prefill:ended -- --export --recheck-alive   Gemini가 '서비스 중'이라 한 게임도 다시 내보내기(최근 종료를 웹 검색으로 확인)
//      (--limit N 으로 앞에서부터 N개만 — 게임위 등급 게임 → 인기순)
//   npm run prefill:ended -- --model gemini-flash-latest   더 큰 모델로(느리지만 더 많이 앎)
//   npm run prefill:ended -- --only grac           ①만 (grac | popular | online)
//   npm run prefill:ended -- --sports              해마다 나오는 스포츠 게임(피파·PES·NBA 2K·매든·NHL·MLB·F1·WWE 등)의 옛 판:
//      공식 온라인 서비스가 끝났는지 따로 묻기 → 끝났으면 오프라인이 돼도 서비스 종료로 숨김(partySize.isAnnualSports)
//
// - 이미 같은 모델로 물어본 게임은 건너뛰므로 중간에 꺼도(Ctrl+C) 다시 실행하면 이어서 합니다.
// - ⚠ npm run prefill:players 와 동시에 돌리지 마세요(같은 파일을 써서 한쪽 결과가 덮일 수 있음).
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createIgdbProvider, titleVariants } from '../server/providers/igdbProvider.js';
import { createPartySize, isAnnualSports, mayEnd } from '../server/services/partySize.js';

const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return d;
  const v = args[i + 1];
  return v == null || v.startsWith('--') ? true : Number.isNaN(Number(v)) ? v : Number(v);
};
const DRY = opt('dry', false) === true;
const EXPORT = opt('export', false) === true;
// --recheck-alive: Gemini가 '서비스 중'이라 한 게임도 외부 AI(웹 검색)용으로 다시 내보냄(--export 와 함께만)
const RECHECK_ALIVE = opt('recheck-alive', false) === true;
const LIMIT = Number(opt('limit', Infinity));
const ONLY = typeof opt('only', null) === 'string' ? opt('only', null) : null;
const MODEL = typeof opt('model', null) === 'string' ? opt('model', null) : null;
const BIG = Boolean(MODEL) && !/lite/i.test(MODEL);
const IGDB_N = Number(opt('igdb', 30000));
const ONLINE_N = Number(opt('online', 0));
const BATCH = Math.min(Math.max(Number(opt('batch', BIG ? 20 : 50)), 5), 100);
// 서버가 붐비거나(503) 응답이 없으면 차례로 바꿔 쓸 Lite 모델 (--fallback a,b 로 바꿀 수 있음, --fallback none 이면 안 바꿈)
const FALLBACK_OPT = typeof opt('fallback', null) === 'string' ? opt('fallback', null) : null;
const FALLBACKS = FALLBACK_OPT === 'none' ? [] : (FALLBACK_OPT ?? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest').split(',').map((x) => x.trim()).filter(Boolean);
const PARALLEL = Math.min(Math.max(Number(opt('parallel', BIG ? 2 : 3)), 1), 10);
const RPM = Math.max(Number(opt('rpm', BIG ? 5 : 15)), 1);
const TIMEOUT_MS = Math.max(Number(opt('timeout', BIG ? 180 : 90)), 10) * 1000;
const want = (k) => !ONLY || ONLY === k;
const SPORTS = opt('sports', false) === true;
// 스포츠 시리즈 이름(IGDB에서 이 낱말이 들어간 게임을 찾은 뒤 isAnnualSports 로 한 해 판만 고름)
const SPORTS_WORDS = ['FIFA', 'EA Sports FC', 'Pro Evolution Soccer', 'PES', 'Winning Eleven', 'NBA 2K', 'NBA Live', 'Madden NFL', 'NHL', 'MLB', 'F1 ', 'WWE', 'NCAA Football', 'PGA Tour'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = getConfig();
const ps = createPartySize({ ...config.gemini, ...(MODEL ? { model: MODEL } : {}), timeoutMs: TIMEOUT_MS, live: false }, { log: (m) => console.log(m) });
const igdb = createIgdbProvider(config.igdb ?? {});
console.log(`IGDB 게임 서비스 종료 확인 · 모델 ${ps.model} · 저장 파일 ${config.gemini.dataFile}`);
if (!igdb.configured) {
  console.log('❌ .env 에 IGDB 설정(IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)이 없습니다.');
  process.exit(1);
}
if (!ps.configured && !DRY && !EXPORT) {
  console.log('❌ .env 에 GEMINI_API_KEY 가 없습니다. (--dry 로 개수만 볼 수는 있어요)');
  process.exit(1);
}

if (SPORTS) {
  const list = new Map();
  for (const w of SPORTS_WORDS) {
    try {
      for (const g of await igdb.listNamed(w)) if (isAnnualSports(g) && !list.has(g.id)) list.set(g.id, g);
    } catch (e) {
      console.log(`⚠ IGDB 조회 실패(${w}): ${e.message}`);
    }
  }
  // 게관위 카드(IGDB에 없는 'XBOX 360_FIFA 16 (피파 16)' 같은 항목)도 같은 기준으로
  const { createGracIndex } = await import('../server/providers/gracIndex.js');
  const { createGracProvider } = await import('../server/providers/gracProvider.js');
  const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed, log: () => {} });
  if (index.snapshot().status !== 'ready') await index.ensure();
  const gracGames = (index.snapshot().games ?? []).filter((g) => isAnnualSports(g) && !ps.applyCached([g])[0].aiEnded);
  const games = [...list.values(), ...gracGames];
  const todo = games.filter((g) => ps.needsSportsCheck(g)).slice(0, LIMIT);
  console.log(`해마다 나오는 스포츠 게임 ${games.length}개 중 물어볼 게임 ${todo.length}개`);
  if (DRY || !todo.length) process.exit(0);
  const sum = { ended: 0, alive: 0, unknown: 0 };
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await ps.askSportsBatch(batch);
        sum.ended += r.ended;
        sum.alive += r.alive;
        sum.unknown += r.unknown;
        break;
      } catch (e) {
        if (attempt >= 4) {
          console.log(`⚠ ${e.message} — 이 묶음은 건너뜀(다시 실행하면 이어서)`);
          break;
        }
        console.log(`⏳ ${e.message} — 20초 쉬었다 다시`);
        await sleep(20_000);
      }
    }
    console.log(`[${Math.min(i + 40, todo.length)}/${todo.length}] 온라인 서비스 종료 ${sum.ended}개(숨김) · 서비스 중 ${sum.alive}개 · 모름 ${sum.unknown}개`);
    await sleep(4000);
  }
  console.log(`
✅ 끝 → ${config.gemini.dataFile} (서버가 켜져 있으면 30초 안에 다시 읽음)`);
  process.exit(0);
}

// 훑은 후보는 파일에 저장해 두고, 같은 옵션으로 24시간 안에 다시 실행하면 IGDB를 다시 훑지 않음 (--rescan 이면 다시 훑기)
const SCAN_FILE = path.join(path.dirname(config.grac.igdbCheckFile), 'ended-candidates.json');
const SCAN_KEY = JSON.stringify({ only: ONLY, igdb: IGDB_N, online: ONLINE_N });
const RESCAN = opt('rescan', false) === true;
const cands = new Map(); // igdb id → { g, force }
const slim = (g) => ({ id: g.id, title: g.title, originalTitle: g.originalTitle ?? null, source: 'IGDB', firstYear: g.firstYear ?? null, platformsRaw: g.platformsRaw ?? null, platforms: g.platforms ?? [], gameModes: g.gameModes ?? [], publisher: g.publisher ?? null, hidden: g.hidden || undefined });
const todo = new Map(); // igdb id → game (아직 안 물어본 것만)
const add = (g, force) => {
  if (!cands.has(g.id)) cands.set(g.id, { g: slim(g), force });
  const needs = RECHECK_ALIVE ? ps.needsExternalEndedCheck(g) : ps.needsEndedCheck(g, { force });
  if (!todo.has(g.id) && needs) todo.set(g.id, g);
};
let fromCache = false;
if (!RESCAN) {
  try {
    const c = JSON.parse(fs.readFileSync(SCAN_FILE, 'utf8'));
    if (c.key === SCAN_KEY && Date.now() - c.at < 24 * 3600_000 && Array.isArray(c.items)) {
      for (const { g, force } of c.items) add(g, force);
      fromCache = true;
      console.log(`저장해 둔 후보 ${c.items.length}개를 씀 (${Math.round((Date.now() - c.at) / 60000)}분 전에 훑음 · IGDB를 다시 훑으려면 --rescan)`);
    }
  } catch {
    /* 없으면 새로 훑기 */
  }
}

// ① 게임위 등급을 받은 IGDB 게임: 사이트가 'IGDB에 있음'으로 확인한 게임위 제목으로 IGDB 게임을 다시 찾음
if (!fromCache && want('grac')) {
  let exists = {};
  try {
    exists = JSON.parse(fs.readFileSync(config.grac.igdbCheckFile, 'utf8'));
  } catch {
    console.log('게임위-IGDB 확인 파일이 없어 ① 건너뜀 (사이트에서 나만의 게임 찾기·prefill:players --grac 를 한 번 돌리면 생김)');
  }
  const titles = Object.entries(exists).filter(([, v]) => v?.exists).map(([t]) => t);
  let done = 0;
  const before = todo.size;
  // 여러 묶음을 동시에(4개) — 하나씩 기다리면 IGDB 초당 4회 한도를 다 못 써서 30분 넘게 걸렸음(한도는 igdbProvider 의 slot() 이 지킴)
  const chunks = [];
  for (let i = 0; i < titles.length; i += 10) chunks.push(titles.slice(i, i + 10));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        // 게임위 제목 그대로와 이름 후보(괄호 안 이름 등)로 찾음: 'Bubble Fighter(버블 파이터)' → Bubble Fighter
        const names = [...new Set(c.flatMap((t) => [t, ...titleVariants(t)]))];
        for (const g of await igdb.findGamesByTitles(names)) add(g, true);
      } catch (e) {
        console.log(`\n⚠ IGDB 조회 실패(이 묶음 건너뜀): ${e.message}`);
      }
      done += c.length;
      if (done % 200 < 10 || done === titles.length) process.stdout.write(`\r① 게임위 등급 IGDB 게임 찾는 중 ${done}/${titles.length} · 확인 대상 ${todo.size - before}개   `);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`\n① 게임위 등급을 받은 IGDB 게임 중 확인 대상 ${todo.size - before}개`);
}

// ② IGDB 인기 게임 중 멀티·협동·MMO·배틀로얄
if (!fromCache && want('popular') && IGDB_N > 0) {
  const before = todo.size;
  let scanned = 0;
  for (let offset = 0; scanned < IGDB_N; offset += 500) {
    const r = await igdb.listPopular({ offset, limit: Math.min(500, IGDB_N - scanned), minRatings: 1 });
    scanned += r.rows;
    r.games.filter(mayEnd).forEach((g) => add(g, false));
    process.stdout.write(`\r② IGDB 인기 게임 훑는 중 ${scanned}/${IGDB_N} · 확인 대상 ${todo.size - before}개   `);
    if (r.rows < 500) break;
  }
  console.log(`\n② 인기 게임 중 온라인 모드가 있는 확인 대상 ${todo.size - before}개`);
}

// ③ 평가 없는 것까지 PC·모바일·웹 온라인 게임
if (!fromCache && want('online') && ONLINE_N > 0) {
  const before = todo.size;
  let scanned = 0;
  let total = null;
  for (let offset = 0; scanned < ONLINE_N; offset += 500) {
    const r = await igdb.listOnline({ offset, limit: Math.min(500, ONLINE_N - scanned) });
    total ??= r.total;
    scanned += r.rows;
    r.games.forEach((g) => add(g, false));
    process.stdout.write(`\r③ PC·모바일·웹 온라인 게임 훑는 중 ${scanned}/${Math.min(ONLINE_N, total ?? ONLINE_N)} · 확인 대상 ${todo.size - before}개   `);
    if (r.rows < 500) break;
  }
  console.log(`\n③ 온라인 게임(전체 ${total ?? '?'}개) 중 확인 대상 ${todo.size - before}개`);
}

if (!fromCache && cands.size) {
  try {
    fs.mkdirSync(path.dirname(SCAN_FILE), { recursive: true });
    fs.writeFileSync(SCAN_FILE, JSON.stringify({ key: SCAN_KEY, at: Date.now(), items: [...cands.values()] }));
  } catch (e) {
    console.log(`(후보 저장 실패: ${e.message})`);
  }
}
if (RECHECK_ALIVE && !EXPORT) {
  console.log('❌ --recheck-alive 는 --export 와 함께만 써요(외부 AI에게 웹 검색으로 다시 확인받는 용도).');
  process.exit(1);
}
const list = [...todo.values()].slice(0, LIMIT);
const calls = Math.ceil(list.length / BATCH);
console.log(`\n물어볼 게임 ${list.length}개 → ${BATCH}개씩 ${calls}번 호출, 동시 ${PARALLEL}개 · 분당 최대 ${RPM}번 → 예상 약 ${Math.ceil(calls / RPM)}분 이상`);
if (EXPORT) {
  // 외부 AI용 CSV: id 는 igdb-<번호> (반영할 때 이 번호로 게임을 찾음)
  const dir = path.join(path.dirname(config.gemini.dataFile), 'status-review');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^ended-games(-part\d+)?\.csv$/.test(f)) fs.rmSync(path.join(dir, f));
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const row = (g) => [`igdb-${String(g.id).replace(/^igdb-/, '')}`, g.originalTitle || g.title, g.firstYear ?? '', g.platformsRaw ?? (g.platforms || []).join('/'), (g.gameModes ?? []).join('/'), g.publisher ?? ''].map(cell).join(',');
  const head = 'id,name,year,platforms,modes,publisher';
  const write = (file, part) => fs.writeFileSync(path.join(dir, file), `\uFEFF${[head, ...part.map(row)].join('\n')}\n`);
  write('ended-games.csv', list);
  const N = 200;
  for (let i = 0; i < list.length; i += N) write(`ended-games-part${i / N + 1}.csv`, list.slice(i, i + N));
  console.log(`📄 ${list.length}개를 ${dir} 에 내보냈어요: ended-games.csv (전체) + ended-games-part1~${Math.ceil(list.length / N)}.csv (200개씩)`);
  console.log('   PROMPT-ENDED.md 의 질문과 함께 외부 AI에게 주고, 받은 답은 npm run import:status -- <결과 파일> 로 반영하세요.');
  process.exit(0);
}
if (DRY || !list.length) {
  console.log(DRY ? '(--dry: 묻지 않고 끝)' : '확인할 게임이 없습니다.');
  process.exit(0);
}

let next = 0;
let finished = 0;
let lastStart = 0;
let pausedUntil = 0;
let stop = false;
const models = [...new Set([ps.model, ...FALLBACKS])];
let modelIdx = 0;
let busyRow = 0; // 연속으로 붐빔·응답 없음
const dayDone = new Set(); // 하루 한도를 다 쓴 모델
const sum = { ended: 0, alive: 0, unknown: 0 };
const gap = 60_000 / RPM;
const t0 = Date.now();
async function slot() {
  for (;;) {
    const now = Date.now();
    if (now < pausedUntil) await sleep(pausedUntil - now);
    else if (now < lastStart + gap) await sleep(lastStart + gap - now);
    else return void (lastStart = now);
  }
}
async function worker() {
  while (!stop && next < calls) {
    const i = next++;
    const batch = list.slice(i * BATCH, (i + 1) * BATCH);
    let switches = 0;
    for (let attempt = 1; !stop; attempt++) {
      await slot();
      try {
        const r = await ps.askEndedBatch(batch);
        busyRow = 0;
        sum.ended += r.ended;
        sum.alive += r.alive;
        sum.unknown += r.unknown;
        break;
      } catch (e) {
        if (e.code === 'GEMINI_QUOTA' && e.perDay) dayDone.add(ps.model);
        // 없어진 모델(404): 이번 실행에서 빼고 바로 다음 모델로 (기다릴 필요 없음)
        if (e.code === 'GEMINI_MODEL_GONE') {
          const gone = ps.model;
          dayDone.add(gone);
          const nextModel = models.find((m) => !dayDone.has(m));
          if (!nextModel) {
            stop = true;
            console.log(`\n⛔ 쓸 수 있는 모델이 없어요 (${e.message}). --model 이나 --fallback 으로 다른 모델 이름을 지정해 주세요.`);
            return;
          }
          modelIdx = models.indexOf(nextModel);
          ps.setModel(nextModel);
          console.log(`🔁 ${gone} 모델은 더 이상 쓸 수 없어서 ${nextModel} 로 바꿔 다시`);
          attempt--;
          continue;
        }
        if (e.code === 'GEMINI_QUOTA' && e.perDay && models.every((m) => dayDone.has(m))) {
          stop = true;
          console.log(`\n⛔ 오늘 Gemini 하루 한도를 다 썼어요. 받은 결과는 저장돼 있어요. 내일 같은 명령을 다시 실행하면 이어서 합니다.`);
          return;
        }
        // 붐빔(503)·응답 없음이 2번 이어지면 다른 Lite 모델로 바꿔 바로 다시 (모델마다 서버 상태·한도가 따로)
        if ((e.code === 'GEMINI_BUSY' || e.code === 'GEMINI_NETWORK' || (e.code === 'GEMINI_QUOTA' && e.perDay)) && models.length > 1) {
          busyRow++;
          if ((busyRow >= 2 || e.perDay) && switches < models.length * 2) {
            busyRow = 0;
            switches++;
            // 하루 한도를 다 쓴 모델은 건너뜀
            for (let k = 0; k < models.length; k++) {
              modelIdx = (modelIdx + 1) % models.length;
              if (!dayDone.has(models[modelIdx])) break;
            }
            ps.setModel(models[modelIdx]);
            console.log(`🔁 ${e.message} — 모델을 ${models[modelIdx]} 로 바꿔 다시`);
            attempt--; // 모델을 바꾼 시도는 횟수에 안 셈 (바꾸는 횟수는 switches 로 제한)
            continue;
          }
        }
        if (attempt > 6) {
          console.log(`⚠ ${e.message} — 이 묶음은 건너뜀(다음 실행 때 다시)`);
          break;
        }
        const wait = e.code === 'GEMINI_QUOTA' ? 60_000 : Math.min(15_000 * 2 ** (attempt - 1), 240_000);
        console.log(`⏳ ${e.message} — ${Math.round(wait / 1000)}초 쉬었다 다시`);
        pausedUntil = Math.max(pausedUntil, Date.now() + wait);
      }
    }
    finished++;
    const left = Math.round((((Date.now() - t0) / finished) * (calls - finished)) / 60000);
    console.log(`[${finished}/${calls}] 누적: 서비스 종료 ${sum.ended}개(숨김) · 서비스 중 ${sum.alive}개 · 모름 ${sum.unknown}개 · 남은 시간 약 ${left}분`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
if (!stop) console.log(`\n✅ 끝: 서비스 종료 ${sum.ended}개(목록에서 숨김) · 서비스 중 ${sum.alive}개 · 모름 ${sum.unknown}개(그대로 보임) → ${config.gemini.dataFile}`);
console.log('서버가 켜져 있으면 30초 안에 자동으로 다시 읽습니다.');
