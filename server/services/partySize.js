// 추천 인원 (AI 추정) — 미리 정리해 둔 데이터 파일을 읽어 씀
//  - IGDB 데이터로 추천 인원을 정할 수 없는 게임(협동 인원이 없고 최대 인원만 큰 게임 등)과
//    게임물관리위원회에만 있는 게임(인원 정보 자체가 없음)만 AI(Google Gemini) 추정 대상입니다.
//    예: 배그는 IGDB 최대 100명이지만, 사람들이 실제로 같이 하는 인원은 1~4명(스쿼드)
//  - AI 추정은 `npm run prefill:players` 로 **미리** 받아 server/data/party-size.json 에 저장합니다.
//    서버는 검색할 때 AI를 부르지 않고 이 파일만 읽습니다(빠르고, 사용량이 검색 수와 무관).
//    (AI_PLAYERS_LIVE=on 이면 예전처럼 파일에 없는 게임을 그때그때 물음 — 기본은 끔)
//  - AI 값은 항상 source: 'ai' 로 표시하고, 화면에서 'AI 추정'이라고 밝힙니다. AI가 모른다고 한 게임·
//    아직 정리 안 된 게임은 '정보 없음'.
//  - 키(GEMINI_API_KEY)는 서버·스크립트에서만 사용하고 브라우저에 보내지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { normTitle, baseTitle } from '../providers/igdbProvider.js';
import { netReason } from '../providers/errors.js';

const TTL = 90 * 86_400_000; // 실시간 모드(AI_PLAYERS_LIVE)에서만 적용. 미리 정리한 값은 만료 없음
const BATCH = 50; // 백그라운드 한 번에 묻는 수
const CHUNK = 12; // 검색 중 바로 물을 때: 작게 나눠 동시에 (답 생성 시간이 답 길이에 비례해서)
const PARALLEL = 4;
// '생각(thinking)' 끄기 설정: 모델마다 받는 이름이 달라 순서대로 시도하고 되는 것을 기억
// Lite 모델은 원래 생각을 하지 않아(점검 결과 생각 토큰 0) 설정 없이 보냄
const THINKING = [{ thinkingLevel: 'minimal' }, { thinkingBudget: 0 }, null];
const QUOTA_PAUSE = 10 * 60_000; // 사용량 초과(429)면 10분 동안 묻지 않음
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const GRAC = '게임물관리위원회';
const igdbNum = (id) => Number(String(id).replace(/^igdb-/, ''));
/** 캐시 키: IGDB는 게임 번호, 게임위는 기본 제목(같은 게임의 플랫폼별 등급분류가 같은 값을 쓰도록) */
export const cacheKey = (g) => (g.source === 'IGDB' ? String(igdbNum(g.id)) : `grac:${normTitle(baseTitle(g.title))}`);
export const needsAi = (g) => 'recommendedPlayers' in g && g.recommendedPlayers == null && (g.source === 'IGDB' || g.source === GRAC);
/** 온라인 서버가 있어야 하는 IGDB 게임(MMO·배틀로얄·멀티 전용) → 서비스 종료 여부도 AI에게 물음 */
export const isOnlineGame = (g) => {
  const m = g.gameModes ?? [];
  return g.source === 'IGDB' && (m.includes('Massively Multiplayer Online (MMO)') || m.includes('Battle Royale') || (m.includes('Multiplayer') && !m.includes('Single player')));
};
/** 서비스가 끝날 수 있는 IGDB 게임(멀티·협동·MMO·배틀로얄 모드가 하나라도 있음) → 서비스 종료 확인 대상 */
export const mayEnd = (g) => g.source === 'IGDB' && (g.gameModes ?? []).some((m) => ['Multiplayer', 'Co-operative', 'Massively Multiplayer Online (MMO)', 'Battle Royale'].includes(m));
const STATUSES = new Set(['released', 'upcoming', 'ended']);

/** 게임 목록 → 프롬프트 (id는 이번 요청 안의 순번 1..n) */
export function buildPrompt(games, today = new Date().toISOString().slice(0, 10)) {
  const lines = games.map((g, i) =>
    JSON.stringify(
      g.source === 'IGDB'
        ? {
            ...(needsAi(g)
              ? { id: i + 1, name: g.originalTitle || g.title, year: g.firstYear ?? null, modes: g.gameModes ?? [], igdbMaxPlayers: g.players?.max ?? null }
              : { id: i + 1, name: g.originalTitle || g.title, year: g.firstYear ?? null, onlyHours: true }),
            ...(isOnlineGame(g) ? { askEnded: true } : {}),
          }
        : {
            id: i + 1,
            name: g.title,
            note: 'Korean title from the Korean game rating board (GRAC)',
            askStatus: true,
            publisher: g.publisher ?? null,
            platform: g.platformsRaw ?? null,
            genre: g.genresRaw ?? null,
            ratedYear: g.ratingDate ? Number(String(g.ratingDate).slice(0, 4)) : null,
          },
    ),
  );
  return [
    'For each video game below, give the recommended party size: how many people usually play it TOGETHER as one group of friends',
    '(e.g. squad/team/party/co-op group, or people on one couch), NOT the total number of players in a match or on a server.',
    'Examples: PUBG: BATTLEGROUNDS -> min 1, max 4 (solo/duo/squad). League of Legends -> min 1, max 5. Minecraft -> min 1, max 8. A single-player-only game -> min 1, max 1.',
    'min is the smallest group that commonly plays (1 if it can be played alone).',
    'If you do not know the game well enough, return null for min and max. Do not guess for unknown games.',
    'Some games are given by their Korean title only; if you cannot identify the actual game, return null. Do not infer only from the genre.',
    'Also give hours: about how many hours it takes to finish the main content (like HowLongToBeat "Main Story"), as an integer.',
    'For endless multiplayer/live-service games without a real ending, or if you do not know, return null for hours.',
    'Games marked "onlyHours": true already have a known party size: return null for their min and max, and only give hours.',
    `Today is ${today}.`,
    'For games marked "askEnded": true, also give ended: true ONLY if you are sure the game\'s online service has been shut down (servers closed), false if you are sure it is still running, null if unsure. For other games return null for ended.',
    'For games marked "askStatus": true, also give status: "ended" ONLY if you are sure the service has been shut down or the game was removed from stores, "upcoming" if it has been announced/rated but is not released yet as of today, "released" if it is out and still available, null if unsure. For other games return null for status.',
    'Return a JSON array with one object {id, min, max, hours, ended, status} per game, using the same id.',
    '',
    ...lines,
  ].join('\n');
}

/**
 * 게임위 게임 서비스 상태 재확인 프롬프트 (엄격): 정확히 이 게임을 알고 '지금도' 할 수 있다고 확신할 때만 released
 * 목록에는 released(또는 App Store에 있는 게임)만 보이므로, 모르면 null → 목록에서 숨김
 */
export const STATUS_VERSION = 2;
export function buildStatusPrompt(games, today = new Date().toISOString().slice(0, 10)) {
  const lines = games.map((g, i) =>
    JSON.stringify({
      id: i + 1,
      name: g.title,
      publisher: g.publisher ?? null,
      platform: g.platformsRaw ?? null,
      genre: g.genresRaw ?? null,
      ratedYear: g.ratingDate ? Number(String(g.ratingDate).slice(0, 4)) : null,
    }),
  );
  return [
    'The games below are Korean titles from the Korean game rating board (GRAC). Many are small or obscure, and many mobile/online/arcade games from them have already shut down.',
    `Today is ${today}. For each game decide its CURRENT status:`,
    '- "released": ONLY if you specifically recognize this exact game (not just a similar name or genre) AND you are confident it can still be played/bought today.',
    '  For packaged console or PC games (sold on disc or in a store, no online service required), "released" means it was actually released.',
    '  For mobile games, online/PC online games, web board games and arcade machines, it means the service is still running and the game is still on stores/in operation today.',
    '- "ended": if you know the service was shut down, the servers were closed, or it was removed from stores.',
    '- "upcoming": if you know it is announced but not released yet as of today.',
    '- null: if you do not specifically know this game or are not sure. When in doubt, return null. Do not guess from the title, publisher or genre.',
    'Return a JSON array with one object {id, status} per game, using the same id.',
    '',
    ...lines,
  ].join('\n');
}

/** IGDB 게임 서비스 종료 확인 프롬프트 (엄격): 게임 자체를 더는 할 수 없을 때만 ended */
export const ENDED_VERSION = 2;
export function buildEndedPrompt(games, today = new Date().toISOString().slice(0, 10)) {
  const lines = games.map((g, i) =>
    JSON.stringify({ id: i + 1, name: g.originalTitle || g.title, year: g.firstYear ?? null, platforms: g.platformsRaw ?? null, modes: g.gameModes ?? [], publisher: g.publisher ?? null }),
  );
  return [
    `Today is ${today}. For each video game below (from the IGDB database), tell whether its service has ended.`,
    '- ended: true ONLY if you know the game itself can no longer be played by new players today: the online service / servers were shut down',
    '  (for online-only games such as MMOs, online casual games, live-service mobile games), or the game was removed from all stores and cannot be obtained or played.',
    '  Do NOT mark ended just because some online features or multiplayer servers closed while the game is still playable (e.g. single-player still works).',
    '- ended: false if you know it is still playable/obtainable today.',
    '- ended: null if you are not sure. When in doubt, return null.',
    'Return a JSON array with one object {id, ended} per game, using the same id.',
    '',
    ...lines,
  ].join('\n');
}

/**
 * 추천 인원만 묻는 프롬프트 (이미 상태·플레이 시간은 받아 둔 게임위 게임에 인원만 채울 때)
 * 작은 국내 게임은 AI가 모르는 경우가 많으므로 '모르면 null'을 강하게 지시
 */
export function buildPlayersPrompt(games) {
  const lines = games.map((g, i) =>
    JSON.stringify(
      g.source === 'IGDB'
        ? { id: i + 1, name: g.originalTitle || g.title, year: g.firstYear ?? null, modes: g.gameModes ?? [], igdbMaxPlayers: g.players?.max ?? null }
        : { id: i + 1, name: g.title, note: 'Korean title from the Korean game rating board (GRAC)', publisher: g.publisher ?? null, platform: g.platformsRaw ?? null, genre: g.genresRaw ?? null },
    ),
  );
  return [
    'For each video game below, give the recommended party size: how many people usually play it TOGETHER as one group of friends',
    '(e.g. squad/team/party/co-op group, or people on one couch), NOT the total number of players in a match or on a server.',
    'Examples: PUBG: BATTLEGROUNDS -> min 1, max 4 (solo/duo/squad). League of Legends -> min 1, max 5. Minecraft -> min 1, max 8. A single-player-only game -> min 1, max 1.',
    'min is the smallest group that commonly plays (1 if it can be played alone).',
    'Many games are given by their Korean title only and are small Korean mobile/online games.',
    'First decide "known": true ONLY if you specifically recognize this exact game (you know what it is and how it is played), false otherwise.',
    'If known is false, return null for min and max. Never infer from the title, publisher or genre.',
    'Return a JSON array with one object {id, known, min, max} per game, using the same id.',
    '',
    ...lines,
  ].join('\n');
}

/** 저장된 항목에 추천 인원 답(숫자 또는 '모름')이 들어 있는지 */
export const hasPlayersAnswer = (e) => Boolean(e && (Number.isInteger(e.min) || e.unknown));

/** AI 플레이 시간 검증: 1~1000시간 정수만 */
export function sanitizeHours(h) {
  return Number.isInteger(h) && h >= 1 && h <= 1000 ? h : null;
}

/** AI 응답 1건 검증: 정수, 1 ≤ min ≤ max ≤ 32, IGDB 최대 인원을 넘지 않음 */
export function sanitize(item, game) {
  const { min, max } = item || {};
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  const cap = game?.players?.max ?? Infinity;
  if (min < 1 || max < min || max > 32) return null;
  const m = Math.min(max, cap);
  if (m < min) return null;
  return { min, max: m };
}

export function createPartySize(cfg = {}, { fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {}) {
  const configured = Boolean(cfg.apiKey);
  const live = configured && Boolean(cfg.live);
  let model = cfg.model || 'gemini-flash-lite-latest'; // 스크립트에서 서버가 붐비면 다른 모델로 바꿀 수 있음(setModel)
  const file = cfg.dataFile || cfg.cacheFile;
  let cache = new Map();
  for (const f of [cfg.legacyCacheFile, file]) {
    // 예전 실시간 캐시(.cache/ai-players.json)가 있으면 함께 읽어 버리지 않음
    try {
      if (f) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) cache.set(k, v);
    } catch {
      /* 없으면 새로 */
    }
  }
  let dirty = false;
  // 서버가 켜진 동안 prefill 스크립트가 파일을 갱신하면 30초 안에 다시 읽음
  let fileMtime = 0;
  let lastCheck = 0;
  try {
    if (file) fileMtime = fs.statSync(file).mtimeMs;
  } catch {
    /* 없음 */
  }
  function maybeReload() {
    if (!file || now() - lastCheck < 30_000) return;
    lastCheck = now();
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m === fileMtime) return;
      fileMtime = m;
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) cache.set(k, v);
      log(`[ai-players] 추천 인원 데이터 다시 읽음 (${cache.size}개)`);
    } catch {
      /* 없거나 쓰는 중이면 다음에 */
    }
  }
  const queue = new Map(); // (실시간 모드) 백그라운드로 물어볼 게임
  let running = false;
  let lastError = null;
  let thinkingIdx = /lite/i.test(model) ? THINKING.length - 1 : 0;
  let pausedUntil = 0;
  const pending = new Map(); // 지금 묻고 있는 게임 → Promise (동시에 들어온 검색이 같은 게임을 두 번 묻지 않게)
  const fresh = (g) => {
    const e = cache.get(cacheKey(g));
    if (!e) return null;
    return !live || now() - e.at < TTL ? e : null;
  };

  function save() {
    if (!file || !dirty) return;
    dirty = false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries([...cache].sort(([a], [b]) => a.localeCompare(b)))));
      fs.renameSync(tmp, file); // 쓰다가 끊겨도 파일이 깨지지 않게
      fileMtime = fs.statSync(file).mtimeMs;
    } catch (e) {
      log(`[ai-players] 저장 실패: ${e.message}`);
    }
  }

  async function ask(games, { pauseOnQuota = true, mode = 'full' } = {}) {
    const useModel = model; // 묻는 도중 모델이 바뀌어도 이 요청은 같은 모델로 기록
    const statusOnly = mode === 'status';
    const endedOnly = mode === 'ended';
    const playersOnly = mode === 'players';
    const schemaItem = playersOnly
      ? { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, known: { type: 'BOOLEAN' }, min: { type: 'INTEGER', nullable: true }, max: { type: 'INTEGER', nullable: true } }, required: ['id', 'known', 'min', 'max'] }
      : statusOnly
      ? { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, status: { type: 'STRING', nullable: true, enum: ['released', 'upcoming', 'ended'] } }, required: ['id', 'status'] }
      : endedOnly
        ? { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, ended: { type: 'BOOLEAN', nullable: true } }, required: ['id', 'ended'] }
        : {
          type: 'OBJECT',
          properties: {
            id: { type: 'INTEGER' },
            min: { type: 'INTEGER', nullable: true },
            max: { type: 'INTEGER', nullable: true },
            hours: { type: 'INTEGER', nullable: true },
            ended: { type: 'BOOLEAN', nullable: true },
            status: { type: 'STRING', nullable: true, enum: ['released', 'upcoming', 'ended'] },
          },
          required: ['id', 'min', 'max', 'hours', 'ended', 'status'],
        };
    if (pauseOnQuota && now() < pausedUntil) throw Object.assign(new Error('Gemini 무료 사용량을 넘어 잠시 쉬는 중입니다'), { code: 'GEMINI_QUOTA' });
    const t0 = now();
    let res;
    for (;;) {
      const used = thinkingIdx;
      const thinkingConfig = THINKING[used];
      try {
        res = await fetchImpl(`${cfg.apiBase || GEMINI_API_BASE}/models/${encodeURIComponent(useModel)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: playersOnly ? buildPlayersPrompt(games) : statusOnly ? buildStatusPrompt(games) : endedOnly ? buildEndedPrompt(games) : buildPrompt(games) }] }],
            generationConfig: {
              temperature: 0,
              ...(thinkingConfig ? { thinkingConfig } : {}),
              responseMimeType: 'application/json',
              responseSchema: { type: 'ARRAY', items: schemaItem },
            },
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000), // 큰 모델은 느려서 스크립트에서 늘려 씀
        });
      } catch (e) {
        throw Object.assign(new Error(`Gemini API에 연결할 수 없습니다 (${netReason(e, cfg.timeoutMs ?? 60_000)})`), { code: 'GEMINI_NETWORK' });
      }
      // 이 모델이 해당 thinking 설정을 받지 않으면(400) 다음 방식으로 다시
      if (res.status === 400 && used < THINKING.length - 1) {
        if (thinkingIdx === used) thinkingIdx++; // 동시에 실패한 다른 호출이 이미 넘겼으면 그대로
        continue;
      }
      break;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 429) {
      if (pauseOnQuota) pausedUntil = now() + QUOTA_PAUSE;
      // 어떤 한도인지(분당/하루) 알 수 있게 Google이 알려 준 한도 이름을 함께
      const quotaId = (body?.error?.details || []).flatMap((d) => d.violations || []).map((v) => v.quotaId).filter(Boolean)[0];
      const perDay = /PerDay/i.test(quotaId || body?.error?.message || '');
      throw Object.assign(new Error(`Gemini 사용량을 넘었습니다(HTTP 429${quotaId ? `, ${quotaId}` : ''})`), { code: 'GEMINI_QUOTA', perDay, detail: String(body?.error?.message || '').slice(0, 300) });
    }
    // 503(서버가 붐빔)·500: 잠깐 뒤 다시 하면 되는 오류
    if (res.status === 503 || res.status === 500 || /high demand|overloaded|UNAVAILABLE/i.test(body?.error?.message || body?.error?.status || '')) {
      throw Object.assign(new Error(`Gemini 서버가 붐벼요(HTTP ${res.status})`), { code: 'GEMINI_BUSY' });
    }
    if (!res.ok) throw Object.assign(new Error(`Gemini API 오류 (HTTP ${res.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 160)}` : ''})`), { code: res.status === 404 ? 'GEMINI_MODEL_GONE' : 'GEMINI_HTTP', status: res.status }); // 404: 없어졌거나 새 사용자에게 막힌 모델
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
    let arr;
    try {
      arr = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw Object.assign(new Error('Gemini 응답을 해석할 수 없습니다.'), { code: 'GEMINI_INVALID' });
    }
    if (!Array.isArray(arr)) throw Object.assign(new Error('Gemini 응답 형식이 예상과 다릅니다.'), { code: 'GEMINI_INVALID' });
    const usage = body?.usageMetadata ?? {};
    const ver = body?.modelVersion ?? useModel;
    log(`[ai-players] ${games.length}개 추정 ${now() - t0}ms (모델 ${ver}, 생각 토큰 ${usage.thoughtsTokenCount ?? 0}, 답 토큰 ${usage.candidatesTokenCount ?? '?'})`);
    const byId = new Map(arr.map((x) => [x?.id, x]));
    let known = 0;
    const day = new Date(now()).toISOString().slice(0, 10);
    if (playersOnly) {
      // 추천 인원만: 기존 항목(서비스 상태·플레이 시간·종료 여부)은 그대로 두고 인원만 더함. 모르면 unknown
      // AI가 이 게임을 정확히 안다고(known: true) 한 경우만 저장 — 작은 게임은 장르로 짐작해 '1~1'을 내는 일이 많았음
      for (const [i, g] of games.entries()) {
        const item = byId.get(i + 1);
        const v = item?.known === true ? sanitize(item, g) : null;
        if (v) known++;
        const k = cacheKey(g);
        const prev = cache.get(k) ?? {};
        cache.set(k, { ...prev, ...(v ?? { unknown: true }), playersModel: ver, playersDate: day, ...(prev.at ? {} : { at: now() }) });
        dirty = true;
      }
      save();
      return { known, unknown: games.length - known };
    }
    if (endedOnly) {
      // IGDB 게임 서비스 종료 여부만: 기존 항목(인원·플레이 시간)은 그대로
      const count = { ended: 0, alive: 0, unknown: 0 };
      for (const [i, g] of games.entries()) {
        const v = byId.get(i + 1)?.ended;
        const ended = v === true ? true : v === false ? false : null;
        count[ended === true ? 'ended' : ended === false ? 'alive' : 'unknown']++;
        const k = cacheKey(g);
        const prev = cache.get(k) ?? {};
        cache.set(k, { ...prev, ended, endedV: ENDED_VERSION, endedModels: [...new Set([...(prev.endedModels ?? []), useModel])], endedDate: day, ...(prev.at ? {} : { at: now() }) });
        dirty = true;
      }
      save();
      return { ...count, endedCount: count.ended };
    }
    if (statusOnly) {
      // 상태만 다시 확인: 기존 항목(인원·플레이 시간)은 그대로, 상태만 바꿈
      const count = { released: 0, ended: 0, upcoming: 0, unknown: 0 };
      for (const [i, g] of games.entries()) {
        const raw = byId.get(i + 1)?.status;
        const st = STATUSES.has(raw) ? raw : null;
        count[st ?? 'unknown']++;
        const k = cacheKey(g);
        const prev = cache.get(k) ?? {};
        const tried = [...new Set([...(prev.statusModels ?? []), useModel])]; // 같은 모델로 '모름'을 다시 묻지 않게
        cache.set(k, { ...prev, status: st, ended: st === 'ended' ? true : st ? false : null, statusV: STATUS_VERSION, statusModel: ver, statusModels: tried, statusDate: day });
        dirty = true;
      }
      save();
      return { status: count, endedCount: count.ended, upcomingCount: count.upcoming };
    }
    let hoursKnown = 0;
    let playersAsked = 0;
    let endedCount = 0;
    let upcomingCount = 0;
    for (const [i, g] of games.entries()) {
      const item = byId.get(i + 1);
      const hours = sanitizeHours(item?.hours);
      if (hours) hoursKnown++;
      // IGDB로 추천 인원이 정해진 게임은 AI 인원을 저장하지 않음(플레이 시간만)
      let players = {};
      if (needsAi(g)) {
        playersAsked++;
        const v = sanitize(item, g);
        if (v) known++;
        players = v ?? { unknown: true };
      }
      // 태그: 출처는 화면에서 'AI 추정', 사용 모델·날짜를 함께 저장. hours 키가 있으면 플레이 시간까지 물어본 항목
      // 게임위 게임: 서비스 종료 여부(AI 판단). 확실할 때만 true/false, 모르면 null
      // 서비스 상태 (AI 판단): 게임위 게임은 출시 예정/출시/종료, 온라인 IGDB 게임은 종료 여부만. 모르면 null
      const extra = {};
      if (g.source === GRAC) {
        const st = STATUSES.has(item?.status) ? item.status : item?.ended === true ? 'ended' : null;
        extra.status = st;
        extra.ended = st === 'ended' ? true : st ? false : null;
      } else if (isOnlineGame(g)) {
        extra.ended = item?.ended === true ? true : item?.ended === false ? false : null;
      }
      if (extra.ended) endedCount++;
      if (extra.status === 'upcoming') upcomingCount++;
      cache.set(cacheKey(g), { ...players, hours, ...extra, model: ver, date: day, at: now() });
      dirty = true;
    }
    save();
    return { known, unknown: playersAsked - known, hoursKnown, playersAsked, endedCount, upcomingCount };
  }

  /** 저장된 값만 붙임: 추천 인원(IGDB로 못 정한 게임만) + AI 플레이 시간(aiPlaytime, RAWG가 없을 때 화면에서 사용) */
  function apply(game) {
    if (game.source !== 'IGDB' && game.source !== GRAC) return game;
    const e = fresh(game);
    let out = game;
    if (e?.hours) out = { ...out, aiPlaytime: e.hours };
    if (e?.ended === true) out = { ...out, aiEnded: true }; // AI가 서비스 종료로 판단 → 목록·검색에서 숨김
    if (game.source === GRAC && e?.status === 'upcoming') out = { ...out, aiUpcoming: true }; // 출시 예정 목록으로
    if (game.source === GRAC && e?.status === 'released' && e.ended !== true) out = { ...out, aiAlive: true }; // AI가 지금도 서비스 중이라고 판단
    if (!('recommendedPlayers' in game) || game.recommendedPlayers) return out;
    if (e && (e.unknown || Number.isInteger(e.min))) return e.unknown ? out : { ...out, recommendedPlayers: { min: e.min, max: e.max, source: 'ai' } };
    if (e) return out; // 서비스 종료 여부만 저장된 항목(인원은 아직 안 물음)
    // AI 추정을 아예 안 쓰는 상태(정리된 데이터도 키도 없음)면 예전처럼 IGDB 최대 인원
    if (!configured && cache.size === 0) return game.players ? { ...out, recommendedPlayers: { ...game.players, source: 'igdb' } } : out;
    return out;
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.size) {
        const batch = [...queue.values()].slice(0, BATCH);
        batch.forEach((g) => queue.delete(cacheKey(g)));
        try {
          const todo = batch.filter((g) => !fresh(g));
          if (todo.length) await ask(todo);
        } catch (e) {
          lastError = e;
          log(`[ai-players] ${e.message}`);
          queue.clear();
        }
        await new Promise((r) => setTimeout(r, cfg.intervalMs ?? 6000));
      }
    } finally {
      running = false;
    }
  }

  return {
    configured,
    live,
    get model() {
      return model;
    },
    /** 모델 바꾸기(스크립트용: 서버가 붐빌 때 다른 Lite 모델로) */
    setModel(m) {
      if (!m || m === model) return;
      model = m;
      thinkingIdx = /lite/i.test(model) ? THINKING.length - 1 : 0;
    },
    get size() {
      return cache.size;
    },
    get lastError() {
      return lastError?.message ?? null;
    },
    /** 추천 인원을 아직 AI에게 안 물은 게임인지 */
    isMissing: (g) => needsAi(g) && !hasPlayersAnswer(fresh(g)),
    /**
     * 추천 인원만 아직 안 물은 게임 (스크립트용, --grac-players)
     * 예: 게임위 게임은 서비스 상태·플레이 시간만 저장돼 있고 인원 답이 없음. 이미 '종료'로 판단된 게임은 제외
     */
    needsPlayers: (g) => {
      if (!needsAi(g)) return false;
      const e = cache.get(cacheKey(g));
      return !hasPlayersAnswer(e) && e?.ended !== true;
    },
    /** 추천 인원만 묻기(스크립트용) */
    askPlayersBatch: (games) => ask(games, { pauseOnQuota: false, mode: 'players' }),
    /** 미리 정리 대상인지: 정리 안 됐거나, 예전 형식(추천 인원만 있고 플레이 시간은 안 물음) */
    needsPrefill: (g) => {
      if (g.source !== 'IGDB' && g.source !== GRAC) return false;
      const e = fresh(g) ?? {};
      if (!('hours' in e)) return true;
      // 게임위: 출시 예정/종료 상태를 아직 안 물었으면 (이미 '종료'로 판단된 게임은 다시 묻지 않음)
      if (g.source === GRAC) return !('status' in e) && e.ended !== true;
      // 온라인 IGDB 게임: 서비스 종료 여부를 아직 안 물었으면
      return isOnlineGame(g) && !('ended' in e);
    },
    /** 엄격한 상태 재확인 대상: 예전 기준으로 'released'라고 받은 게임위 게임 */
    needsStatusRecheck: (g) => {
      if (g.source !== GRAC) return false;
      const e = fresh(g);
      return Boolean(e && e.status === 'released' && e.ended !== true && e.statusV !== STATUS_VERSION);
    },
    /** '모름' 재확인 대상: 게임위 게임 중 상태를 모른다고 받았고, 이 모델로는 아직 안 물어본 것 */
    needsUnknownRecheck: (g) => {
      if (g.source !== GRAC) return false;
      const e = fresh(g);
      return Boolean(e && 'status' in e && e.status == null && e.ended !== true && e.statusModel !== model && !(e.statusModels ?? []).includes(model));
    },
    /** IGDB 서비스 종료 확인 대상: 이 모델로 아직 엄격 기준으로 안 물어본 게임 (force: 서비스 종료 가능성과 상관없이) */
    needsEndedCheck: (g, { force = false } = {}) => {
      if (g.source !== 'IGDB' || g.hidden || (!force && !mayEnd(g))) return false;
      const e = cache.get(cacheKey(g));
      if (!e || e.endedV !== ENDED_VERSION) return true;
      const tried = e.endedModels ?? [];
      if (tried.includes(model) || tried.includes('external')) return false; // 이 모델·외부 AI로 이미 확인
      return e.ended == null; // 다른 모델이 이미 종료/서비스 중으로 판단했으면 다시 묻지 않음(모름만 다시)
    },
    /** 서비스 종료 여부만 묻기(스크립트용) */
    askEndedBatch: (games) => ask(games, { pauseOnQuota: false, mode: 'ended' }),
    /** 상태만 다시 묻기(스크립트용) */
    askStatusBatch: (games) => ask(games, { pauseOnQuota: false, mode: 'status' }),
    /** IGDB로 추천 인원이 정해진 게임에 예전에 저장한 AI 인원이 있으면 지움(플레이 시간은 유지). 지웠으면 true */
    dropAiPlayers(g) {
      if (needsAi(g) || !('recommendedPlayers' in g)) return false;
      const k = cacheKey(g);
      const e = cache.get(k);
      if (!e || !('min' in e || 'unknown' in e)) return false;
      const { min, max, unknown, ...rest } = e;
      cache.set(k, rest);
      dirty = true;
      return true;
    },
    save,
    /** 미리 정리하기(스크립트용): 한 묶음을 묻고 저장. 429면 code GEMINI_QUOTA 오류 */
    askBatch: (games) => ask(games, { pauseOnQuota: false }),
    /** 목록용: 저장된 값만 붙임 (실시간 모드면 없는 것을 백그라운드로 물어봄) */
    applyCached(games) {
      maybeReload();
      if (live) {
        for (const g of games) if (needsAi(g) && !fresh(g) && queue.size < 500) queue.set(cacheKey(g), g);
        if (queue.size) drain();
      }
      return games.map(apply);
    },
    /**
     * 추천 결과·상세용. 기본(미리 정리 모드)은 저장된 값만 붙이고 바로 돌아옴.
     * 실시간 모드: 없는 것은 12개씩 나눠 동시에 묻되 waitMs 넘게 붙잡지 않음
     */
    async fill(games, { waitMs = cfg.waitMs ?? 8000 } = {}) {
      maybeReload();
      if (live) {
        const waits = [];
        const missing = new Map();
        for (const g of games) {
          if (!needsAi(g) || fresh(g)) continue;
          const k = cacheKey(g);
          if (pending.has(k)) waits.push(pending.get(k));
          else missing.set(k, g);
        }
        const list = [...missing.values()];
        const chunks = [];
        for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
        let next = 0;
        const runChunk = (chunk) => {
          const p = ask(chunk).finally(() => chunk.forEach((g) => pending.delete(cacheKey(g))));
          chunk.forEach((g) => pending.set(cacheKey(g), p.catch(() => {})));
          return p;
        };
        const errors = [];
        const worker = async () => {
          while (next < chunks.length) await runChunk(chunks[next++]).catch((e) => errors.push(e));
        };
        let timer;
        const done = Promise.all([...Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker), ...waits]).then(() => 'done');
        const outcome = await Promise.race([done, new Promise((r) => (timer = setTimeout(() => r('late'), waitMs)))]);
        clearTimeout(timer);
        if (outcome === 'late') {
          log(`[ai-players] ${waitMs}ms 안에 다 못 받아 먼저 보여 줌 (계속 받는 중)`);
          done.then(() => errors.length && log(`[ai-players] ${errors[0].message}`));
          return { games: games.map(apply), warning: 'AI 추천 인원을 아직 받는 중이라 일부 게임은 인원이 ‘정보 없음’으로 보여요. 잠시 뒤 다시 찾으면 표시돼요.', late: true };
        }
        if (errors.length) {
          lastError = errors[0];
          log(`[ai-players] ${errors[0].message}`);
          return { games: games.map(apply), warning: `AI 추천 인원을 일부 가져오지 못했어요 (${errors[0].message}). 해당 게임은 인원 '정보 없음'으로 보여요.` };
        }
      }
      return { games: games.map(apply), warning: null };
    },
  };
}
