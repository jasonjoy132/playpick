// 게관위 새 게임: 하루 한 번 새로 등급분류된 게임을 받아(DB grac_new) 바로 판단(DB ai_grac) — 비용 0원
//  - 배포(Vercel)는 git 시드(server/data/grac-index.json)만 읽으므로, 시드 이후 새 게임은 이 표로 덧붙임
//  - 판단 근거는 실제로 찾은 스토어 페이지만: PC는 Steam, 모바일은 App Store(이름·개발사 일치)
//      찾으면 → 출시 예정(Steam '곧 출시')/서비스 중 + 스토어 설명을 Gemini(검색 없음)에게 주고 추천 인원·플레이 시간 판단
//      못 찾으면 → 상태 '모름'으로 두고 7일마다 다시 찾음(최대 4번). 그동안 등급분류 6개월 안이면 '최근 등급분류'로 목록에 보임
//    (Gemini 무료 키는 Google 검색 연결이 막혀 있고, 검색 없는 Gemini는 새 게임을 모름 → 스토어에서 근거를 직접 찾아 줌)
//  - 실행: Vercel Cron(GET /api/cron/grac, 하루 1번) · 관리자 화면 버튼 · 로컬 서버 시작 때(하루 넘었으면)
//  - 키는 서버에서만. 인원·플레이 시간은 화면에 'AI 추정', 상태는 근거 스토어를 함께 보여 줌
import { GEMINI_API_BASE, cacheKey, sanitize, sanitizeHours } from './partySize.js';
import { matchApp } from '../providers/appStoreProvider.js';
import { titleKeys, titleVariants, baseTitle } from '../providers/igdbProvider.js';
import { netReason } from '../providers/errors.js';
import { isOffTopic } from './taxonomy.js';

const GRAC = '게임물관리위원회';
const DAY = 86_400_000;
export const RECENT_DAYS = 180; // 근거를 못 찾은 새 게임을 '최근 등급분류'로 보여 주는 기간
const RECHECK_DAYS = 7;
const MAX_TRIES = 4;
const STEAM_SEARCH = 'https://store.steampowered.com/api/storesearch/';
const STEAM_DETAILS = 'https://store.steampowered.com/api/appdetails';
const kday = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
const keyOf = (g) => cacheKey({ ...g, source: GRAC });
const isPc = (g) => /PC|온라인/.test(g.platformsRaw ?? '');
const isMobile = (g) => /모바일/.test(g.platformsRaw ?? '');
/** Steam 분류(영어)에 여럿이 하는 방식이 있는지 */
const MULTI = /Multi-player|PvP|Co-op|MMO|Split Screen|Cross-Platform Multiplayer/i;
const clip = (s, n) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** 찾을 이름 후보: 원래 제목 · 기본 제목 · 괄호 안 이름 등 (최대 3개) */
const namesOf = (g) => [...new Set([g.title, baseTitle(g.title), ...titleVariants(g.title)].filter(Boolean))].slice(0, 3);
const sameName = (a, g) => {
  const keys = new Set(namesOf(g).flatMap((n) => titleKeys(n)));
  return titleKeys(a).some((k) => keys.has(k));
};

/** Steam: 이름이 같은 게임 → { evidence: 'steam', status, storeUrl, storeName, info } */
export async function findOnSteam(g, fetchImpl) {
  for (const name of namesOf(g)) {
    const u = new URL(STEAM_SEARCH);
    u.search = new URLSearchParams({ term: name, l: 'koreana', cc: 'KR' }).toString();
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Steam HTTP ${r.status}`);
    const hit = ((await r.json())?.items ?? []).find((i) => i?.type === 'app' && sameName(i.name, g));
    if (!hit) continue;
    const d = await fetchImpl(`${STEAM_DETAILS}?appids=${hit.id}&cc=kr&l=english`, { signal: AbortSignal.timeout(8000) });
    const data = d.ok ? (await d.json())?.[hit.id]?.data : null;
    return {
      evidence: 'steam',
      status: data?.release_date?.coming_soon ? 'upcoming' : 'released',
      storeUrl: `https://store.steampowered.com/app/${hit.id}`,
      storeName: 'Steam',
      info: { storeTitle: hit.name, description: clip(data?.short_description, 500), features: (data?.categories ?? []).map((c) => c.description).slice(0, 12), genres: (data?.genres ?? []).map((x) => x.description) },
    };
  }
  return null;
}

/** App Store: 이름 + 개발사가 같은 앱 → 서비스 중 */
export async function findOnAppStore(g, appStore) {
  if (!appStore?.search || !g.publisher) return null;
  for (const name of namesOf(g).slice(0, 2)) {
    const app = matchApp(await appStore.search(name), { title: name, publisher: g.publisher });
    if (app && /^https:\/\/apps\.apple\.com\//.test(String(app.trackViewUrl))) {
      return {
        evidence: 'appstore',
        status: 'released',
        storeUrl: app.trackViewUrl,
        storeName: 'App Store',
        info: { storeTitle: app.trackName, description: clip(app.description, 500), genres: app.genres ?? [] },
      };
    }
  }
  return null;
}

/** 스토어 정보 → 추천 인원·플레이 시간 프롬프트 (검색 없이, 준 정보로만) */
export function buildStorePrompt(items) {
  return [
    'For each video game below you get its real store page information. Using ONLY this information, give:',
    '- min, max: recommended party size = how many people usually play it TOGETHER as one group of friends (squad/party/co-op/couch), NOT players per match. Single-player only -> 1 and 1. null if the information does not tell.',
    '- hours: about how many hours to finish the main content; null for endless online games or if unknown.',
    '"features" are Steam store categories: only "Single-player" (no multiplayer feature) means min 1, max 1. If any Multi-player / PvP / Co-op / MMO / Split Screen feature exists, max is at least 2 (a 1v1 PvP game -> 2; team or co-op games -> the usual team/co-op size from the description).',
    'Return a JSON array with one object {id, min, max, hours} per game, using the same id.',
    '',
    ...items.map(({ game, found }, i) => JSON.stringify({ id: i + 1, name: game.title, storeTitle: found.info.storeTitle, description: found.info.description, features: found.info.features ?? [], genres: found.info.genres ?? [] })),
  ].join('\n');
}

async function askPlayers(items, ai, fetchImpl) {
  const model = ai.model || 'gemini-flash-lite-latest';
  let res;
  try {
    res = await fetchImpl(`${ai.apiBase || GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ai.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildStorePrompt(items) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, min: { type: 'INTEGER', nullable: true }, max: { type: 'INTEGER', nullable: true }, hours: { type: 'INTEGER', nullable: true } }, required: ['id', 'min', 'max', 'hours'] },
          },
        },
      }),
      signal: AbortSignal.timeout(ai.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw Object.assign(new Error(`Gemini API에 연결할 수 없습니다 (${netReason(e, ai.timeoutMs ?? 30_000)})`), { code: 'GEMINI_NETWORK' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`Gemini API 오류 (HTTP ${res.status})`), { code: res.status === 429 ? 'GEMINI_QUOTA' : 'GEMINI_HTTP' });
  let arr;
  try {
    arr = JSON.parse(body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '');
  } catch {
    arr = null;
  }
  if (!Array.isArray(arr)) throw Object.assign(new Error('Gemini 응답을 해석할 수 없습니다.'), { code: 'GEMINI_INVALID' });
  const byId = new Map(arr.map((x) => [Number(x?.id), x]));
  return { model: body?.modelVersion ?? model, results: items.map((_, i) => byId.get(i + 1) ?? {}) };
}

/**
 * Steam 분류는 실제 근거라 AI 답보다 우선: 싱글 플레이만 → 1~1, 여럿이 하는 방식이 있는데 AI가 1명이라 하면 버림(모름)
 * (App Store 는 분류가 없어 AI 답 그대로)
 */
export function fixByFeatures(v, hit) {
  const f = hit?.evidence === 'steam' ? hit.info?.features ?? [] : null;
  if (!f) return v;
  const multi = f.some((x) => MULTI.test(x));
  if (!multi && f.includes('Single-player')) return { min: 1, max: 1 };
  if (multi && v && v.max < 2) return null;
  return v;
}

/**
 * @param db  회원 DB (grac_new · ai_grac · sync_runs)
 * @param {{ grac, appStore?, seedGames?: () => Array, hasFileJudgement?: (g) => boolean, ai: { apiKey?, model?, live? } }} opt
 */
export function createGracNew(db, { grac, appStore = null, seedGames = () => [], hasFileJudgement = () => false, ai = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {}) {
  const aiOn = Boolean(ai.apiKey) && ai.live !== false;
  const q = {
    lastRun: db.prepare("SELECT last_at, note FROM sync_runs WHERE name = 'grac'"),
    setRun: db.prepare("INSERT INTO sync_runs (name, last_at, note) VALUES ('grac', ?, ?) ON CONFLICT(name) DO UPDATE SET last_at = excluded.last_at, note = excluded.note"),
    put: db.prepare('INSERT INTO grac_new (rating_no, game_json, rated_at, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(rating_no) DO UPDATE SET game_json = excluded.game_json, rated_at = excluded.rated_at'),
    all: db.prepare('SELECT game_json FROM grac_new ORDER BY rated_at DESC, rating_no DESC'),
    judged: db.prepare('SELECT * FROM ai_grac'),
    save: db.prepare(
      `INSERT INTO ai_grac (key, status, min, max, hours, model, evidence, store_url, store_name, tries, next_check, judged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET status = excluded.status, min = excluded.min, max = excluded.max, hours = excluded.hours, model = excluded.model, evidence = excluded.evidence,
       store_url = excluded.store_url, store_name = excluded.store_name, tries = excluded.tries, next_check = excluded.next_check, judged_at = excluded.judged_at`,
    ),
  };

  /** DB → { games: 새 게임 목록, judgements: Map(key → 판단) } */
  async function load() {
    const games = (await q.all.all()).map((r) => JSON.parse(r.game_json));
    const judgements = new Map((await q.judged.all()).map((r) => [r.key, r]));
    return { games, judgements };
  }

  /** 1) 게관위에서 새로 등급분류된 게임 받기 → 시드에 없는 것만 저장(이미 있으면 취소 여부 등 갱신) */
  async function sync() {
    const seed = seedGames();
    const seedNos = new Set(seed.map((g) => g.ratingNo));
    const seedLatest = seed.reduce((m, g) => (String(g.ratingDate || '') > m ? String(g.ratingDate) : m), '');
    const last = (await q.lastRun.get())?.last_at;
    // 마지막 실행(없으면 시드의 가장 최근 등급분류일) 이틀 전부터: 등급분류일과 공개일이 어긋나도 놓치지 않게, 최대 60일
    const fromMs = last ? Date.parse(last) - 2 * DAY : seedLatest ? Date.parse(seedLatest) - 2 * DAY : now() - 14 * DAY;
    const startdate = kday(Math.max(fromMs, now() - 60 * DAY));
    const fresh = [];
    for (let pageno = 1; pageno <= 10; pageno++) {
      const r = await grac.fetchPage({ pageno, display: 1000, startdate });
      fresh.push(...r.games);
      if (pageno * 1000 >= r.total) break;
    }
    const t = new Date(now()).toISOString();
    const had = new Set((await load()).games.map((g) => g.ratingNo));
    let saved = 0;
    for (const g of fresh) {
      if (!g.ratingNo || seedNos.has(g.ratingNo)) continue;
      await q.put.run(g.ratingNo, JSON.stringify(g), g.ratingDate ?? '', t); // 이미 있으면 취소 여부 등만 갱신
      if (!had.has(g.ratingNo)) saved++;
    }
    return { startdate, fetched: fresh.length, saved };
  }

  /** 2) 판단: 아직 없거나 '못 찾음'이라 다시 볼 때가 된 새 게임 → 스토어 근거 → (찾으면) Gemini 인원·시간 */
  async function judge({ max = 40 } = {}) {
    const { games, judgements } = await load();
    const t = now();
    const seen = new Set();
    const todo = games.filter((g) => {
      const k = keyOf(g);
      if (g.canceled || isOffTopic(g) || hasFileJudgement(g) || seen.has(k)) return false;
      seen.add(k);
      const j = judgements.get(k);
      return !j || (!j.status && (j.tries ?? 0) < MAX_TRIES && (j.next_check ?? 0) <= t);
    });
    const pick = todo.slice(0, max);
    const count = { released: 0, upcoming: 0, notFound: 0 };
    const errors = [];
    // 스토어 찾기 (4개씩 동시에)
    const found = new Map();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, pick.length) }, async () => {
        while (next < pick.length) {
          const g = pick[next++];
          try {
            const hit = (isPc(g) ? await findOnSteam(g, fetchImpl) : null) ?? (isMobile(g) ? await findOnAppStore(g, appStore) : null);
            found.set(keyOf(g), { game: g, found: hit });
          } catch (e) {
            errors.push(`${g.title}: ${e.message}`); // 스토어가 응답하지 않음 → 저장 안 함(다음에 다시)
          }
        }
      }),
    );
    // 찾은 게임은 Gemini 에게 인원·시간 (실패해도 상태는 저장, 인원은 '모름')
    const withStore = [...found.values()].filter((x) => x.found);
    const players = new Map();
    let model = null;
    if (aiOn && withStore.length) {
      for (let i = 0; i < withStore.length; i += 10) {
        const part = withStore.slice(i, i + 10);
        try {
          const r = await askPlayers(part, ai, fetchImpl);
          model = r.model;
          part.forEach((x, k) => players.set(keyOf(x.game), r.results[k]));
        } catch (e) {
          errors.push(`AI: ${e.message}`);
        }
      }
    }
    const at = new Date(t).toISOString();
    for (const [k, { game, found: hit }] of found) {
      const prev = judgements.get(k);
      if (hit) {
        const p = players.get(k) ?? {};
        const v = fixByFeatures(sanitize(p, game), hit);
        await q.save.run(k, hit.status, v?.min ?? null, v?.max ?? null, sanitizeHours(p.hours), players.has(k) ? model : null, hit.evidence, hit.storeUrl, hit.storeName, (prev?.tries ?? 0) + 1, null, at);
        count[hit.status]++;
      } else {
        await q.save.run(k, null, null, null, null, null, null, null, null, (prev?.tries ?? 0) + 1, t + RECHECK_DAYS * DAY, at);
        count.notFound++;
      }
    }
    return { checked: found.size, waiting: todo.length - found.size, count, errors };
  }

  /** 수집 + 판단 + 실행 기록 → 요약 */
  async function run() {
    const t0 = now();
    let synced;
    try {
      synced = await sync();
    } catch (e) {
      log(`[grac-new] 게관위 수집 실패: ${e.message}`);
      return { ok: false, error: `게임물관리위원회 목록을 받지 못했어요: ${e.message}` };
    }
    const judged = await judge();
    const c = judged.count;
    const note = `새 게임 ${synced.saved}개 · 확인 ${judged.checked}개(서비스 중 ${c.released}·출시 예정 ${c.upcoming}·못 찾음 ${c.notFound})${judged.errors.length ? ` · 오류 ${judged.errors.length}` : ''}`;
    await q.setRun.run(new Date(t0).toISOString(), note);
    log(`[grac-new] ${note} (${now() - t0}ms, ${synced.startdate}부터 ${synced.fetched}건 확인)`);
    for (const e of judged.errors.slice(0, 5)) log(`[grac-new]   ${e}`);
    return { ok: true, ...synced, judge: judged, note, ms: now() - t0 };
  }

  return {
    load,
    sync,
    judge,
    run,
    lastRun: async () => (await q.lastRun.get()) ?? null,
    /** 관리자 화면: 최근 새 게임 + 판단 */
    async recent(limit = 30) {
      const { games, judgements } = await load();
      return games.slice(0, limit).map((g) => {
        const j = judgements.get(keyOf(g));
        return {
          id: g.id,
          title: g.title,
          publisher: g.publisher,
          platforms: g.platformsRaw,
          ratingDate: g.ratingDate,
          canceled: Boolean(g.canceled),
          judgement: hasFileJudgement(g)
            ? { fromFile: true }
            : j
              ? { status: j.status, min: j.min, max: j.max, hours: j.hours, storeName: j.store_name, storeUrl: j.store_url, tries: j.tries, nextCheck: j.next_check ? new Date(j.next_check).toISOString() : null, judgedAt: j.judged_at }
              : null,
        };
      });
    },
  };
}

/**
 * DB 판단 → partySize 덧씌우기 항목 (partySize.apply 가 씀)
 *  - 스토어에서 찾음: status released/upcoming, 인원(있으면), 근거 스토어
 *  - 못 찾음·아직 안 봄: recentNew (등급분류 6개월 안이면 '최근 등급분류'로 보임)
 */
export function overlayEntries({ games, judgements }) {
  const out = new Map();
  for (const g of games) {
    if (g.canceled) continue;
    const k = keyOf(g);
    if (out.has(k)) continue;
    const j = judgements.get(k);
    if (j?.status) {
      out.set(k, {
        ...(Number.isInteger(j.min) ? { min: j.min, max: j.max } : { unknown: true }),
        hours: j.hours ?? null,
        status: j.status,
        ended: false,
        model: j.model,
        storeUrl: j.store_url,
        storeName: j.store_name,
        newGame: true,
      });
    } else {
      out.set(k, { unknown: true, recentNew: true, newGame: true });
    }
  }
  return out;
}
