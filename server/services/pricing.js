// 유료·무료 구분 — 스토어 근거 먼저, 없으면 미리 저장한 AI 판단, 그래도 없으면 '정보 없음'
//  - 무료 = 처음 시작이 무료(인앱 결제가 있어도 무료) · 유료 = 사거나 구독해야 시작 가능. 금액은 할인 때문에 자주 바뀌어 보여 주지 않음
//  - 파일: server/data/price.json ( `npm run prefill:price` 로 만듦, 서버는 읽기만 )
//    { "igdb-71": { free: true|false|null, source: 'steam'|'appstore'|'ai', date, ... } , "grac:<기본제목>": {...} }
//    free: null 은 확인했지만 모름(AI가 모른다고 함·출시 전) → 다시 묻지 않으려고 저장
//  - 상세 화면: Steam 상점 주소가 있는데 파일에 스토어 근거가 없으면 그 자리에서 Steam에 물음(하루 저장, 최대 2.5초)
//  - 화면 표시: source 'ai' 는 'AI 추정', 스토어는 'Steam 기준'·'App Store 기준'
import fs from 'node:fs';
import path from 'node:path';
import { artKey } from './appArt.js';
import { steamAppId } from './steamTrailer.js';

const GRAC = '게임물관리위원회';
const RELOAD_MS = 30_000;
const DAY = 24 * 60 * 60e3;
const FAIL_RETRY = 10 * 60e3;
export const STORE_SOURCES = new Set(['steam', 'appstore']);
const SOURCES = new Set(['steam', 'appstore', 'ai']);

/** 저장 키: IGDB는 게임 id, 게관위는 App Store 아이콘과 같은 기본 제목 키 */
export function priceKey(game) {
  if (!game || game.isDemo) return null;
  if (game.source === 'IGDB') return game.id;
  if (game.source === GRAC) return artKey(game);
  return null;
}

/** Steam appdetails(basic,release_date) 응답 → true(무료)·false(유료)·null(모름: 실패·출시 전) */
export function steamFree(json, appid) {
  const e = json?.[appid];
  if (!e?.success || !e.data) return null;
  if (typeof e.data.is_free !== 'boolean') return null;
  if (e.data.is_free) return true;
  // 출시 전 게임은 가격이 정해지지 않았을 수 있음 → 모름
  return e.data.release_date?.coming_soon ? null : false;
}

/** App Store lookup 결과 하나 → true·false·null */
export function appStoreFree(app) {
  const p = Number(app?.price);
  return Number.isFinite(p) ? p === 0 : null;
}

/** App Store 주소의 앱 번호 */
export const appStoreId = (url) => String(url ?? '').match(/\/id(\d+)/)?.[1] ?? null;

/**
 * @param {string|null} file 저장 파일(null 이면 메모리만 — 테스트용)
 * @param {{ entries?: Record<string, object>, now?: () => number }} opt
 */
export function createPricing(file, { entries = {}, now = () => Date.now() } = {}) {
  let map = new Map(Object.entries(entries));
  let mtime = 0;
  let lastCheck = 0;
  let dirty = false;
  const load = () => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m === mtime) return;
      map = new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
      mtime = m;
    } catch {
      /* 없거나 쓰는 중이면 그대로 */
    }
  };
  const fresh = () => {
    if (!file || now() - lastCheck < RELOAD_MS) return;
    lastCheck = now();
    load();
  };
  if (file) {
    load();
    lastCheck = now();
  }

  /** 화면에 보낼 값 { free, source } 또는 null(정보 없음) */
  function get(game) {
    fresh();
    const e = map.get(priceKey(game));
    return e && typeof e.free === 'boolean' && SOURCES.has(e.source) ? { free: e.free, source: e.source } : null;
  }

  return {
    get size() {
      fresh();
      return map.size;
    },
    get,
    /** 목록·상세에 `price` 붙이기 (이미 있으면 그대로) */
    applyAll(games) {
      return games.map((g) => {
        if (g.price !== undefined) return g;
        const p = get(g);
        return p ? { ...g, price: p } : g;
      });
    },
    /** 스크립트용: 저장된 항목 그대로 */
    entry: (key) => map.get(key),
    has: (key) => map.has(key),
    /** 스크립트용: 기록 (free: true·false·null) */
    set(key, free, source, extra = {}) {
      map.set(key, { free, source, ...extra, date: new Date(now()).toISOString().slice(0, 10) });
      dirty = true;
    },
    save() {
      if (!file || !dirty) return;
      dirty = false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)))));
      fs.renameSync(tmp, file);
      mtime = fs.statSync(file).mtimeMs;
    },
  };
}

/** AI에게 여러 게임을 한 번에 묻는 질문 (스토어 근거가 없는 게임만) */
export function buildPricePrompt(games) {
  const list = games.map((g, i) => ({
    i,
    name: g.originalTitle || g.title,
    year: g.releaseDate ? Number(String(g.releaseDate).slice(0, 4)) : null,
    platforms: g.platformsRaw ?? null,
  }));
  return [
    'For each video game below, say whether it is free to start or paid, as of now.',
    '- free: the base game can be downloaded and played without paying (free-to-play; in-app purchases or paid DLC are fine).',
    '- paid: you must buy the game or keep a subscription to play it.',
    '- If the game switched from paid to free-to-play (or the reverse), answer its current state.',
    '- If you do not specifically know this exact game, set known=false and free=null. Do not guess from the title or genre.',
    'Return a JSON array of {i, known, free}.',
    '',
    JSON.stringify(list),
  ].join('\n');
}

/** AI 답 → Map(i → true·false·null). known=false 거나 이상한 값은 null */
export function parsePriceAnswer(arr) {
  const out = new Map();
  for (const x of Array.isArray(arr) ? arr : []) {
    if (!Number.isInteger(x?.i)) continue;
    out.set(x.i, x.known === true && typeof x.free === 'boolean' ? x.free : null);
  }
  return out;
}

/** 상세 화면용 Steam 유료·무료 실시간 확인 (한 게임 하루 저장, 오류는 10분 뒤 다시) */
export function createSteamPrice({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 6000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function lookup(appid) {
    try {
      const r = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=kr&filters=basic,release_date`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`Steam ${r.status}`);
      const value = steamFree(await r.json(), appid);
      cache.set(appid, { at: now(), ttl: DAY, value });
      return value;
    } catch {
      cache.set(appid, { at: now(), ttl: FAIL_RETRY, value: null });
      return null;
    }
  }
  function get(appid) {
    const hit = cache.get(appid);
    if (hit && now() - hit.at < hit.ttl) return Promise.resolve(hit.value);
    if (!pending.has(appid)) pending.set(appid, lookup(appid).finally(() => pending.delete(appid)));
    return pending.get(appid);
  }
  return {
    get,
    /** 게임에 Steam 근거 `price` 붙이기 — 이미 스토어 근거가 있으면 그대로, 최대 waitMs 기다림 */
    async attach(game, { waitMs = 2500 } = {}) {
      if (game.price && STORE_SOURCES.has(game.price.source)) return game;
      const appid = steamAppId(game);
      if (!appid) return game;
      let timer;
      const late = new Promise((r) => (timer = setTimeout(() => r(undefined), waitMs)));
      const free = await Promise.race([get(appid), late]);
      clearTimeout(timer);
      return typeof free === 'boolean' ? { ...game, price: { free, source: 'steam' } } : game;
    },
  };
}
