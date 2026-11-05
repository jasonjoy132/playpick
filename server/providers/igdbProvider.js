// IGDB API 모듈 — 플레이픽의 기본 데이터 출처 (게임위 API는 IGDB에 없는 게임 추가·국내 등급 보완용)
//
// 확인한 문서
//  - 인증: Twitch 'Client credentials grant flow'
//      POST https://id.twitch.tv/oauth2/token  (x-www-form-urlencoded)
//      client_id, client_secret, grant_type=client_credentials → { access_token, expires_in, token_type }
//      (https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
//  - 필드 구조: IGDB 공식 스키마 https://api.igdb.com/v4/igdbapi.proto
//      Game: name, summary, genres, platforms, game_modes, multiplayer_modes, cover, websites,
//            alternative_names, game_localizations, version_parent ...
//      MultiplayerMode: onlinemax, offlinemax, onlinecoopmax, offlinecoopmax ...
//      Website: url, trusted, type(WebsiteType)   ※ category 는 deprecated
//      Cover: url, image_id
//      AgeRating: organization(AgeRatingOrganization.name), rating_category(AgeRatingCategory.rating)
// 공식 문서 사이트(api-docs.igdb.com)는 열지 못했습니다. 요청 헤더(Client-ID, Authorization: Bearer)와
// Apicalypse 쿼리 문법은 널리 쓰이는 방식대로 작성했으며, `npm run check:apis` 로 실제 호출을 검증합니다.
// Client Secret·토큰은 서버에서만 사용하고 브라우저·로그·오류 메시지에 노출하지 않습니다.
import { DataSourceError, netReason } from './errors.js';

export const IGDB_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const IGDB_API_BASE = 'https://api.igdb.com/v4';

// 플레이픽 조건 → IGDB 이름 (실제 이름 목록은 /genres, /platforms 응답으로 대조하며, 없는 이름은 무시)
export const IGDB_GENRE_NAMES = {
  action: ['Fighting', "Hack and slash/Beat 'em up", 'Platform'],
  rpg: ['Role-playing (RPG)'],
  strategy: ['Strategy', 'Real Time Strategy (RTS)', 'Turn-based strategy (TBS)', 'Tactical'],
  simulation: ['Simulator'],
  adventure: ['Adventure', 'Point-and-click'],
  shooting: ['Shooter'],
  sports: ['Sport'],
  racing: ['Racing'],
  puzzle: ['Puzzle'],
  party: ['Card & Board Game', 'Quiz/Trivia'],
};
export const IGDB_PLATFORM_NAMES = {
  pc: ['PC (Microsoft Windows)', 'Mac', 'Linux'],
  mobile: ['Android', 'iOS'],
  console: ['PlayStation 5', 'PlayStation 4', 'Xbox Series X|S', 'Xbox One', 'Nintendo Switch', 'Nintendo Switch 2'],
  arcade: ['Arcade'],
};

// 구매처로 인정하는 주소(호스트) — IGDB가 제공한 URL 중 이 목록에 해당하는 것만 구매처로 표시
const STORE_HOSTS = [
  ['store.steampowered.com', 'Steam'],
  ['store.epicgames.com', 'Epic Games Store'],
  ['epicgames.com', 'Epic Games Store'],
  ['gog.com', 'GOG'],
  ['itch.io', 'itch.io'],
  ['apps.apple.com', 'App Store'],
  ['itunes.apple.com', 'App Store'],
  ['play.google.com', 'Google Play'],
  ['store.playstation.com', 'PlayStation Store'],
  ['xbox.com', 'Microsoft Store (Xbox)'],
  ['microsoft.com', 'Microsoft Store'],
  ['nintendo.com', 'Nintendo eShop'],
  ['nintendo.co.kr', 'Nintendo eShop'],
];

const GAME_FIELDS = [
  'name', 'summary', 'first_release_date', 'url', 'hypes',
  'genres.name', 'platforms.name', 'game_modes.name',
  'multiplayer_modes.onlinemax', 'multiplayer_modes.offlinemax',
  'multiplayer_modes.onlinecoopmax', 'multiplayer_modes.offlinecoopmax',
  'cover.url', 'artworks.url', 'screenshots.url', 'websites.url', 'websites.trusted',
  'alternative_names.name', 'alternative_names.comment',
  'game_localizations.name', 'game_localizations.region.name',
  'involved_companies.company.name', 'involved_companies.publisher',
  'age_ratings.organization.name', 'age_ratings.rating_category.rating',
  'game_status.status', 'game_type.type', 'parent_game',
  'total_rating', 'total_rating_count', 'rating', 'rating_count', 'aggregated_rating', 'aggregated_rating_count',
].join(',');

/** IGDB 100점 만점 → 5점 만점(소수 첫째 자리) */
const to5 = (v) => Math.round((Number(v) / 20) * 10) / 10;
const part = (v, n) => (Number.isFinite(Number(v)) && Number(n) > 0 ? { avg: to5(v), count: Number(n) } : null);

/**
 * 글로벌 평점: IGDB total_rating(이용자 rating + 평론가 aggregated_rating 평균, 0~100) ÷ 20
 * 평가 수가 없으면 null (만들어 내지 않음)
 */
export function globalRatingFromIgdb(g) {
  const total = part(g.total_rating, g.total_rating_count);
  if (!total) return null;
  return { ...total, users: part(g.rating, g.rating_count), critics: part(g.aggregated_rating, g.aggregated_rating_count), source: 'IGDB' };
}

// 본편만: 다른 판(에디션·이식판, version_parent)과 본편에 딸린 항목(시즌·DLC·확장팩·에피소드, parent_game) 제외
export const MAIN_ONLY = ['version_parent = null', 'parent_game = null'];

/** IGDB game_modes id 1 = 'Single player' */
export const SINGLE_PLAYER_MODE = 1;
const MP_MAX_FIELDS = ['onlinemax', 'offlinemax', 'onlinecoopmax', 'offlinecoopmax'];

/**
 * 인원 조건 → IGDB where 절 (derivePlayers 와 같은 기준)
 *  - 1명: game_modes 에 Single player
 *  - n명(2~4): 멀티플레이 최대 인원(온라인/오프라인/협동) 중 하나라도 n 이상
 *  - 5(5명 이상): 최대 인원 5 이상
 */
export function playersWhere(n) {
  if (n == null) return null;
  if (n === 1) return `game_modes = (${SINGLE_PLAYER_MODE})`;
  return `(${MP_MAX_FIELDS.map((f) => `multiplayer_modes.${f} >= ${n}`).join(' | ')})`;
}
// game_type 으로 한 번 더 거르기: 본편이 아닌 항목 (Standalone Expansion·Remake·Remaster·Port 등은 별도 게임으로 둠)
const NOT_MAIN_TYPE = /^(dlc|add.?on|bundle|pack|update|mod|season|episode|expansion)/i;
export const isMainGame = (g) => !g.parent_game && !NOT_MAIN_TYPE.test(String(g.game_type?.type ?? ''));

// 목록에서 숨길 IGDB 게임 상태 (GameStatus.status). Offline = 서비스 종료
export const DEFAULT_HIDDEN_STATUSES = ['Offline'];

// IGDB 등급 중 한국(GRAC) 등급 → 표시용 한국어. 표에 없는 값은 원문 그대로 표시
const GRAC_RATING_KO = {
  all: '전체이용가', twelve: '12세이용가', '12': '12세이용가', fifteen: '15세이용가', '15': '15세이용가',
  eighteen: '청소년이용불가', '18': '청소년이용불가', testing: '시험용',
};

/** IGDB age_ratings 에서 게임물관리위원회(GRAC) 등급만 추출 */
export function gracRatingFromIgdb(game) {
  const r = (game.age_ratings || []).find((a) => /^grac$/i.test(a.organization?.name || ''));
  const raw = r?.rating_category?.rating;
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/^grac[\s_-]*/, '').trim();
  return GRAC_RATING_KO[key] || raw;
}

const quote = (s) => `"${String(s).replace(/["\\]/g, '')}"`;

export function storeFromUrl(url) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = STORE_HOSTS.find(([h]) => host === h || host.endsWith(`.${h}`));
  return hit ? { name: hit[1], url, isDemo: false } : null;
}

/**
 * 플레이 인원 도출 (IGDB 데이터에 근거가 있을 때만)
 *  - multiplayer_modes 의 최대 인원(online/offline/coop max) 중 가장 큰 값 = 최대 인원
 *    최소 인원: game_modes 에 'Single player' 가 있으면 1, 없으면 2
 *  - 멀티플레이 정보가 없고 game_modes 가 'Single player' 뿐이면 1명
 *  - 그 외에는 null (정보 없음)
 */
export function derivePlayers(game) {
  const modes = (game.game_modes || []).map((m) => m.name);
  const hasSingle = modes.includes('Single player');
  const maxes = (game.multiplayer_modes || [])
    .flatMap((m) => [m.onlinemax, m.offlinemax, m.onlinecoopmax, m.offlinecoopmax])
    .filter((n) => Number.isInteger(n) && n > 0);
  if (maxes.length) {
    const max = Math.max(...maxes);
    const min = hasSingle ? 1 : 2;
    return { min: Math.min(min, max), max };
  }
  if (modes.length === 1 && hasSingle) return { min: 1, max: 1 };
  return null;
}

/**
 * 추천 인원 (IGDB 실제 데이터로 정할 수 있는 경우만, 아니면 null → AI 추정 대상)
 *  1) 협동 최대 인원(onlinecoopmax/offlinecoopmax)이 2명 이상: 친구와 한 팀으로 하는 인원 (예: 배그 스쿼드 4명)
 *  2) 최대 인원이 8명 이하(싱글 전용 포함): 그 범위 그대로
 *  3) 그 밖(대규모 대전·MMO 등 최대 인원만 크게 있는 경우, 정보 없음) → null
 */
export function recommendFromIgdb(game, players = derivePlayers(game)) {
  const hasSingle = (game.game_modes || []).some((m) => m.name === 'Single player');
  const coop = Math.max(0, ...(game.multiplayer_modes || []).flatMap((m) => [m.onlinecoopmax, m.offlinecoopmax]).filter((n) => Number.isInteger(n) && n > 0));
  if (coop >= 2) return { min: hasSingle ? 1 : 2, max: coop, source: 'igdb-coop' };
  if (players && players.max <= 8) return { min: players.min, max: players.max, source: 'igdb' };
  return null;
}

function koreanName(game) {
  const loc = (game.game_localizations || []).find((l) => /korea/i.test(l.region?.name || ''));
  if (loc?.name) return loc.name;
  const alt = (game.alternative_names || []).find((a) => /korean/i.test(a.comment || ''));
  return alt?.name || null;
}

/** IGDB 이미지 URL(//images.igdb.com/.../t_thumb/xx.jpg) → https + 원하는 크기 */
export function igdbImage(url, size) {
  if (!url) return null;
  const u = `https:${String(url).replace(/^https?:/, '')}`;
  return u.startsWith('https://images.igdb.com/') ? u.replace(/\/t_[a-z0-9_]+\//, `/${size}/`) : null;
}

/**
 * 띄어쓰기 없이 입력한 영문 검색어 → 띄어 쓴 경우의 IGDB slug 후보
 *  예: 'lostark' → ['lostark', 'l-ostark', …, 'lost-ark', …] (20자 이하는 두 군데 띄우는 경우까지, 예: leagueoflegends → league-of-legends)
 *  영문·숫자만, 4~24자일 때만 (그 밖은 빈 배열)
 */
export function spacingSlugs(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!/^[a-z0-9]{4,24}$/.test(t)) return [];
  const out = new Set([t]);
  for (let i = 1; i < t.length; i++) {
    out.add(`${t.slice(0, i)}-${t.slice(i)}`);
    if (t.length <= 20) for (let j = i + 1; j < t.length; j++) out.add(`${t.slice(0, i)}-${t.slice(i, j)}-${t.slice(j)}`);
  }
  return [...out];
}

/** 제목 비교용 정규화 (공백·기호 제거, 소문자) */
export const normTitle = (t) => String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// 제목 뒤에 붙는 플랫폼·판 표기 (같은 게임 판단용으로만 제거)
const EDITION_SUFFIX = /\s*(?:[-–:]\s*)?(?:for\s+)?(?:nintendo\s+switch|switch|ps[345]|playstation\s*[345]?|xbox(?:\s+(?:one|series\s+x\|?s?))?|pc|steam|mobile|모바일|스위치|for\s+kakao|kakao)\s*(?:판|버전|edition)?\s*$/i;

/** 괄호·대괄호 안 내용과 끝의 플랫폼 표기를 뗀 기본 제목: '포털 2 (PS3)' → '포털 2' */
export function baseTitle(t) {
  let s = String(t || '').replace(/\s*[([{【［（][^)\]}】］）]*[)\]}】］）]\s*/g, ' ').trim();
  for (let k = 0; k < 2; k++) s = s.replace(EDITION_SUFFIX, '').trim();
  return s || String(t || '');
}

/** 같은 게임 판단용 키: 정규화한 제목, 정규화한 기본 제목 */
export const titleKeys = (t) => [...new Set([normTitle(t), normTitle(baseTitle(t))])].filter(Boolean);

// 게임위 제목 앞뒤에 붙는 플랫폼 표기: 'PC_몬스터 헌터', 'Portal 2_PC', '레프트 4 데드-PC', '(PC스팀)', '(닌텐도 스위치 버전)'
const PLATFORM_HEAD = /^\s*(?:pc|ns|ps[345]|steam)\s*[_:\-–]\s*/i;
// 끝의 플랫폼 표기는 앞에 구분자(공백·_·-)가 있을 때만 (예: 'Champions' 끝의 'ns'를 지우지 않게)
const PLATFORM_TAIL = /[\s_\-–,]+(?:pc\s*스팀|pc|ns|steam|ps[345]|xbox(?:\s*(?:one|series\s*[xs|/]*))?|닌텐도\s*스위치(?:\s*버전)?|스위치\s*버전|nintendo\s*switch)\s*$/i;
// 괄호 안에 혼자 있으면 이름이 아닌 것
const NOT_A_NAME = /^(?:pc|pc\s*스팀|ns|ps[345]|steam|xbox.*|nintendo.*|닌텐도.*|스위치.*|mobile|모바일|체험판|한글판|정식판|데모|demo|lite|beta|베타|무료|free|dlc|ost|.*버전|.*에디션|.*edition)$/i;

/**
 * 게임위 제목 → IGDB에서 찾아볼 이름 후보들
 *  'Portal 2(포탈 2)_PC' → Portal 2, 포탈 2 / 'Baldur＇s Gate 3' → Baldur's Gate 3 (전각 기호 정리)
 *  '카트라이더 드리프트 (Kartrider Drift) [PC]' → 카트라이더 드리프트, Kartrider Drift
 */
export function titleVariants(t) {
  const clean = (v) => {
    let x = String(v).replace(/\s+/g, ' ').trim();
    for (let k = 0; k < 2; k++) x = x.replace(PLATFORM_HEAD, '').replace(PLATFORM_TAIL, '').trim();
    return x.replace(/[\s_\-–:]+$/, '').trim();
  };
  const s = clean(String(t || '').normalize('NFKC').replace(/[™®©]/g, ''));
  if (!s) return [];
  // 괄호 안 이름을 안쪽부터 꺼냄: '오버워치 (NS) (Overwatch (NS))' → NS, NS, Overwatch / 괄호 밖: 오버워치
  const BR = /[([{【]([^()[\]{}【】]*)[)\]}】]/g;
  const inner = [];
  let outer = s;
  for (let k = 0; k < 3 && BR.test(outer); k++) {
    BR.lastIndex = 0;
    inner.push(...[...outer.matchAll(BR)].map((m) => m[1]));
    outer = outer.replace(BR, ' ');
  }
  outer = outer.replace(/[()[\]{}【】]/g, ' '); // 짝 안 맞는 괄호 기호
  const out = new Set();
  for (const p of [s, outer, ...inner]) {
    const v = clean(p);
    if (NOT_A_NAME.test(v)) continue;
    for (const x of [v, clean(baseTitle(v))]) {
      if (normTitle(x).length >= 3 && !NOT_A_NAME.test(x) && !/[()[\]{}【】]/.test(x)) out.add(x);
    }
  }
  return [...out];
}

/** IGDB 플랫폼 이름 → 종류 (게임위 플랫폼 구분과 비교용) */
export function platformClasses(platforms) {
  const out = new Set();
  for (const p of platforms || []) {
    const n = String(p?.name ?? p);
    if (/android|ios|mobile|windows phone/i.test(n)) out.add('mobile');
    else if (/arcade/i.test(n)) out.add('arcade');
    else if (/pc|windows|mac|linux|dos|web browser/i.test(n)) out.add('pc');
    else out.add('console');
  }
  return [...out];
}

/** 영문 이름 → IGDB slug 후보 ('Kartrider Drift' → kartrider-drift, 'Left4Dead' → left-4-dead 등 띄어쓰기 경우) */
export function titleSlugs(name) {
  const n = String(name || '').normalize('NFKC').toLowerCase();
  if (!/^[\x20-\x7e]+$/.test(n)) return [];
  const slug = n.replace(/['’`.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug || slug.length < 3) return [];
  // 한 단어로 붙여 쓴 짧은 이름만 띄어쓰기 경우를 더 만듦 (너무 많아지지 않게 12자까지)
  return [...new Set([slug, ...(slug.includes('-') || slug.length > 12 ? [] : spacingSlugs(slug))])];
}

function shotsOf(g) {
  const pick = (list) => [...new Set((list || []).map((x) => igdbImage(x.url, 't_screenshot_big')).filter(Boolean))].slice(0, 6);
  const shots = pick(g.screenshots);
  const list = shots.length ? shots : pick(g.artworks);
  return list.length ? { screenshots: list, screenshotSource: 'IGDB' } : {};
}

/** IGDB game → 플레이픽 게임 모델 */
export function igdbToGame(g, maps) {
  const toValues = (items, nameMap) => {
    if (!items?.length) return null;
    const names = new Set(items.map((i) => i.name));
    const values = Object.entries(nameMap).filter(([, ns]) => ns.some((n) => names.has(n))).map(([v]) => v);
    return values.length ? values : null;
  };
  const ko = koreanName(g);
  const coverUrl = igdbImage(g.cover?.url, 't_cover_big');
  const wide = g.artworks?.[0]?.url || g.screenshots?.[0]?.url;
  const bannerUrl = igdbImage(wide, 't_screenshot_big');
  const stores = [];
  for (const w of g.websites || []) {
    const s = storeFromUrl(w.url);
    if (s && !stores.some((x) => x.url === s.url)) stores.push(s);
  }
  const publisher = (g.involved_companies || []).find((c) => c.publisher)?.company?.name
    ?? g.involved_companies?.[0]?.company?.name ?? null;
  return {
    id: `igdb-${g.id}`,
    title: ko || g.name,
    originalTitle: ko ? g.name : null,
    isDemo: false,
    source: 'IGDB',
    publisher,
    summary: g.summary || null, // IGDB 소개는 대부분 영어 원문
    platforms: toValues(g.platforms, maps?.platforms ?? IGDB_PLATFORM_NAMES),
    platformsRaw: g.platforms?.length ? g.platforms.map((p) => p.name).join(', ') : null,
    genres: toValues(g.genres, maps?.genres ?? IGDB_GENRE_NAMES),
    genresRaw: g.genres?.length ? g.genres.map((x) => x.name).join(', ') : null,
    players: derivePlayers(g),
    recommendedPlayers: recommendFromIgdb(g),
    firstYear: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    gameModes: (g.game_modes || []).map((m) => m.name),
    // 국내 등급: IGDB에 GRAC 등급이 있으면 표시, 없으면 게임위 데이터로 보완(catalog.mergeGames)
    rating: gracRatingFromIgdb(g),
    ratingSource: gracRatingFromIgdb(g) ? 'IGDB(GRAC 등급)' : null,
    domesticRating: Boolean(gracRatingFromIgdb(g)),
    ratingDate: null,
    ratingNo: null,
    contentDescriptors: null,
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    igdbUrl: g.url || null,
    imageUrl: coverUrl,
    bannerUrl,
    // 상세 '스크린샷' 칸용 (이미 받아 온 응답에서 주소만, 최대 6장. 없으면 아트워크)
    ...shotsOf(g),
    globalRating: globalRatingFromIgdb(g),
    gameStatus: g.game_status?.status ?? null, // 예: Released, Offline(서비스 종료), Delisted, Cancelled
    stores,
    // 다른 사이트(RAWG 등)에서 찾을 때 쓸 영문 이름들: 원제 + 별칭(한글 제외)
    altNames: [...new Set([g.name, ...(g.alternative_names || []).map((a) => a.name)].filter((n) => n && !/[\uac00-\ud7a3]/.test(n)))].slice(0, 6),
    matchNames: [...new Set([g.name, ko, ...(g.alternative_names || []).map((a) => a.name), ...(g.game_localizations || []).map((l) => l.name)]
      .filter(Boolean)
      .flatMap(titleKeys))],
  };
}

export function createIgdbProvider(cfg, { fetchImpl = globalThis.fetch, now = () => Date.now(), cacheTtlSec = 3600 } = {}) {
  const configured = Boolean(cfg.clientId && cfg.clientSecret);
  const hiddenStatuses = (cfg.hiddenStatuses ?? DEFAULT_HIDDEN_STATUSES).map((x) => x.toLowerCase());
  // 숨길 게임은 지우지 않고 hidden 표시 → 게임위의 같은 게임이 따로 나타나지 않도록 합치기에는 사용
  const mark = (game) => (game.gameStatus && hiddenStatuses.includes(game.gameStatus.toLowerCase()) ? { ...game, hidden: true } : game);
  let token = null; // { value, expiresAt }
  let idMaps = null; // { genres: {value: [ids]}, platforms: {value: [ids]} }
  const cache = new Map(); // criteria key → { at, games }

  async function getToken() {
    if (token && now() < token.expiresAt) return token.value;
    let res;
    try {
      res = await fetchImpl(IGDB_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new DataSourceError('IGDB_NETWORK', 'IGDB 인증 서버(Twitch)에 연결할 수 없습니다.');
    }
    if (!res.ok) {
      throw new DataSourceError('IGDB_AUTH', `IGDB 인증에 실패했습니다 (HTTP ${res.status}). IGDB_CLIENT_ID / IGDB_CLIENT_SECRET 을 확인해 주세요.`);
    }
    const body = await res.json().catch(() => null);
    if (!body?.access_token) throw new DataSourceError('IGDB_AUTH', 'IGDB 인증 응답에 토큰이 없습니다.');
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    token = { value: body.access_token, expiresAt: now() + (ttl - 60) * 1000 };
    return token.value;
  }

  async function query(endpoint, body, opt) {
    const json = await request(endpoint, body, opt);
    if (!Array.isArray(json)) throw new DataSourceError('IGDB_INVALID', 'IGDB API가 예상하지 못한 형식의 응답을 반환했습니다.');
    return json;
  }
  /** /games/count 등: { count } */
  async function count(endpoint, body) {
    const json = await request(`${endpoint}/count`, body);
    return Number.isInteger(json?.count) ? json.count : null;
  }
  // IGDB 호출 제한(초당 4회) 안에서 보내기: 최근 1초에 4번 보냈으면 잠깐 기다림
  const starts = [];
  async function slot() {
    for (;;) {
      const t = Date.now();
      while (starts.length && t - starts[0] >= 1000) starts.shift();
      if (starts.length < 4) {
        starts.push(t);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (t - starts[0]) + 5));
    }
  }
  async function request(endpoint, body, { timeoutMs = 15_000 } = {}, attempt = 0) {
    await slot();
    if (!configured) throw new DataSourceError('IGDB_NOT_CONFIGURED', 'IGDB 설정(IGDB_CLIENT_ID, IGDB_CLIENT_SECRET)이 없습니다.', 503);
    const access = await getToken();
    let res;
    try {
      res = await fetchImpl(`${IGDB_API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Client-ID': cfg.clientId, Authorization: `Bearer ${access}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // 잠깐 끊긴 경우가 많아서 시간 초과가 아니면 1번 더 시도
      if (attempt === 0 && e?.name !== 'TimeoutError') return request(endpoint, body, { timeoutMs }, 1);
      throw new DataSourceError('IGDB_NETWORK', `IGDB API에 연결할 수 없습니다 (${netReason(e, timeoutMs)}).`);
    }
    if (res.status === 401 && attempt < 2) {
      token = null; // 토큰 만료 → 1회 재발급
      return request(endpoint, body, { timeoutMs }, 2);
    }
    if (res.status === 429) throw new DataSourceError('IGDB_RATE_LIMIT', 'IGDB 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.', 503);
    if (!res.ok) throw new DataSourceError('IGDB_HTTP', `IGDB API 오류 (HTTP ${res.status})`);
    const json = await res.json().catch(() => null);
    if (json == null) throw new DataSourceError('IGDB_INVALID', 'IGDB API가 예상하지 못한 형식의 응답을 반환했습니다.');
    return json;
  }

  /** 장르·플랫폼 이름 → IGDB id (실제 목록에서 찾은 것만) */
  async function getIdMaps() {
    if (idMaps) return idMaps;
    const [genres, platforms] = await Promise.all([
      query('genres', 'fields id,name; limit 500;'),
      query('platforms', `fields id,name; where name = (${Object.values(IGDB_PLATFORM_NAMES).flat().map(quote).join(',')}); limit 500;`),
    ]);
    const build = (nameMap, rows) =>
      Object.fromEntries(Object.entries(nameMap).map(([v, names]) => [v, rows.filter((r) => names.includes(r.name)).map((r) => r.id)]));
    idMaps = { genres: build(IGDB_GENRE_NAMES, genres), platforms: build(IGDB_PLATFORM_NAMES, platforms) };
    return idMaps;
  }

  return {
    name: 'igdb',
    label: 'IGDB',
    configured,
    getIdMaps,
    query,
    /** 조건(장르·플랫폼)에 맞는 IGDB 게임 후보 (인기순, 최대 limit개) */
    /**
     * 조건(장르·플랫폼)에 맞는 추천 후보
     *  - 인기 게임(평가 수 많은 순) 최대 300개
     *  - 함께할 인원을 2명 이상 골랐다면: 멀티플레이 인원 정보가 있는 게임 최대 200개를 추가로 가져와 합침
     *    (인원 정보가 있어야 '모든 조건 일치'가 될 수 있어서)
     */
    async searchByCriteria(criteria, limit = 300) {
      const wantsGroup = Number(criteria.players) >= 2;
      const key = JSON.stringify([criteria.platforms, criteria.genres, limit, wantsGroup]);
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlSec * 1000) return hit.games;
      const maps = await getIdMaps();
      const ids = (values, map) => [...new Set(values.flatMap((v) => map[v] || []))];
      const where = [...MAIN_ONLY, 'total_rating_count > 0'];
      const g = ids(criteria.genres, maps.genres);
      const p = ids(criteria.platforms, maps.platforms);
      if (g.length) where.push(`genres = (${g.join(',')})`);
      if (p.length) where.push(`platforms = (${p.join(',')})`);
      const base = `fields ${GAME_FIELDS}; where ${where.join(' & ')}`;
      const [popular, group] = await Promise.all([
        query('games', `${base}; sort total_rating_count desc; limit ${limit};`),
        wantsGroup ? query('games', `${base} & multiplayer_modes != null; sort total_rating_count desc; limit 200;`) : Promise.resolve([]),
      ]);
      const seen = new Set();
      const games = [...popular, ...group]
        .filter((r) => !seen.has(r.id) && seen.add(r.id))
        .filter(isMainGame)
        .map((r) => mark(igdbToGame(r)));
      cache.set(key, { at: now(), games });
      return games;
    },
    /**
     * IGDB 전체에서 조건(장르·플랫폼·인원)을 모두 만족하는 게임을 인기순으로 페이지 단위 조회
     * 후보를 미리 받아 두지 않고, 필터를 IGDB 쪽에서 적용해 전체 DB를 대상으로 찾음
     */
    async findMatches(criteria, { offset = 0, limit = 24 } = {}) {
      const maps = await getIdMaps();
      const ids = (values, map) => [...new Set(values.flatMap((v) => map[v] || []))];
      const where = [...MAIN_ONLY];
      const g = ids(criteria.genres, maps.genres);
      const p = ids(criteria.platforms, maps.platforms);
      // 선택했는데 IGDB에 대응 id가 없으면 일치하는 게임이 있을 수 없음
      if ((criteria.genres.length && !g.length) || (criteria.platforms.length && !p.length)) return { games: [], total: 0, hasMore: false };
      if (g.length) where.push(`genres = (${g.join(',')})`);
      if (p.length) where.push(`platforms = (${p.join(',')})`);
      const pw = playersWhere(criteria.players);
      if (pw) where.push(pw);
      const w = where.join(' & ');
      const key = JSON.stringify(['find', w, offset, limit]);
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlSec * 1000) return hit.value;
      const [rows, total] = await Promise.all([
        query('games', `fields ${GAME_FIELDS}; where ${w}; sort total_rating_count desc; limit ${limit}; offset ${offset};`),
        offset === 0 ? count('games', `where ${w};`) : Promise.resolve(null),
      ]);
      const games = rows.filter(isMainGame).map((r) => mark(igdbToGame(r)));
      const value = { games, total, hasMore: rows.length === limit && (total == null || offset + limit < total) };
      cache.set(key, { at: now(), value });
      return value;
    },
    /** 추천 인원 미리 정리용: 평가 수가 많은 순으로 본편 게임 목록 */
    async listPopular({ offset = 0, limit = 500, minRatings = 1 } = {}) {
      const w = `${MAIN_ONLY.join(' & ')} & total_rating_count >= ${Math.max(0, Number(minRatings) || 0)}`;
      const [rows, total] = await Promise.all([
        query('games', `fields ${GAME_FIELDS}; where ${w}; sort total_rating_count desc; limit ${limit}; offset ${offset};`, { timeoutMs: 45_000 }),
        offset === 0 ? count('games', `where ${w};`) : Promise.resolve(null),
      ]);
      return { games: rows.filter(isMainGame).map((r) => mark(igdbToGame(r))), rows: rows.length, total };
    },
    async getGame(id) {
      const n = Number(String(id).replace(/^igdb-/, ''));
      if (!Number.isInteger(n) || n <= 0) return null;
      const rows = await query('games', `fields ${GAME_FIELDS}; where id = ${n}; limit 1;`);
      return rows[0] ? mark(igdbToGame(rows[0])) : null;
    },
    /** 첫 화면용 인기 게임 (표지 있는 게임, 평가 수 많은 순) */
    async featured(limit = 30) {
      const key = `featured:${limit}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlSec * 1000) return hit.games;
      const rows = await query('games', `fields ${GAME_FIELDS}; where ${MAIN_ONLY.join(' & ')} & cover != null & total_rating_count > 0; sort total_rating_count desc; limit ${limit + 10};`);
      const games = rows.filter(isMainGame).map((r) => mark(igdbToGame(r))).filter((g) => !g.hidden).slice(0, limit);
      cache.set(key, { at: now(), games });
      return games;
    },
    /**
     * 메뉴별 목록 (인기·신작·출시 예정·평점 랭킹·장르별)
     * @param {'popular'|'recent'|'upcoming'|'top'} kind
     * @param {{ genre?: string, platform?: string, offset?: number, limit?: number }} opt
     */
    async browse(kind, { genre, platform, offset = 0, limit = 24 } = {}) {
      const key = `browse:${kind}:${genre ?? ''}:${platform ?? ''}:${offset}:${limit}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlSec * 1000) return hit.value;
      const where = [...MAIN_ONLY, 'cover != null'];
      if (genre || platform) {
        const maps = await getIdMaps();
        const g = genre ? maps.genres[genre] || [] : [];
        const p = platform ? maps.platforms[platform] || [] : [];
        if (genre && !g.length) return { games: [], hasMore: false };
        if (platform && !p.length) return { games: [], hasMore: false };
        if (g.length) where.push(`genres = (${g.join(',')})`);
        if (p.length) where.push(`platforms = (${p.join(',')})`);
      }
      const t = Math.floor(now() / 1000);
      let sort;
      if (kind === 'popular') {
        where.push('total_rating_count > 0');
        sort = 'total_rating_count desc';
      } else if (kind === 'recent') {
        // 최근 90일 안에 출시된 게임, 출시 전 관심(hypes)이 많았던 순
        where.push(`first_release_date >= ${t - 90 * 86400}`, `first_release_date <= ${t}`);
        sort = 'hypes desc';
      } else if (kind === 'upcoming') {
        where.push(`first_release_date > ${t}`);
        sort = 'hypes desc';
      } else if (kind === 'top') {
        // 평가가 충분히 많은 게임만 (적은 평가로 만점 받은 게임이 위로 오지 않게)
        where.push('total_rating_count >= 100');
        sort = 'total_rating desc';
      } else {
        throw new DataSourceError('BAD_REQUEST', '알 수 없는 목록입니다.', 400);
      }
      const rows = await query('games', `fields ${GAME_FIELDS}; where ${where.join(' & ')}; sort ${sort}; limit ${limit}; offset ${offset};`);
      const hideCancelled = kind === 'upcoming' ? ['cancelled'] : [];
      const games = rows
        .filter(isMainGame)
        .map((r) => mark(igdbToGame(r)))
        .filter((g) => !g.hidden && !hideCancelled.includes(String(g.gameStatus).toLowerCase()))
        .map(({ matchNames, ...g }) => g);
      const value = { games, hasMore: rows.length === limit };
      cache.set(key, { at: now(), value });
      return value;
    },
    /** 여러 IGDB 게임 한 번에 조회 (회원 평점 랭킹 보강용) */
    async getMany(ids) {
      const nums = ids.map((id) => Number(String(id).replace(/^igdb-/, ''))).filter((n) => Number.isInteger(n) && n > 0);
      if (!nums.length) return [];
      const rows = await query('games', `fields ${GAME_FIELDS}; where id = (${nums.join(',')}); limit ${nums.length};`);
      return rows.map((r) => mark(igdbToGame(r))).map(({ matchNames, ...g }) => g);
    },
    /**
     * 주어진 이름들과 정확히(대소문자 무시) 같은 이름·별칭·현지화명을 가진 IGDB 게임의 이름 목록
     * (게임위 게임이 IGDB에 이미 있는지 확인용 — 본편·다른 판 구분 없이 IGDB에 있으면 '있음')
     */
    async findTitles(names) {
      return (await this.findTitleGames(names)).flatMap((g) => g.names);
    },
    /**
     * 이름으로 IGDB 게임 찾기 → [{ names: [이름·별칭·현지화 이름], platforms: ['pc'|'mobile'|'console'|'arcade'] }]
     * (게임위 게임이 IGDB에 있는지 확인용. 플랫폼은 흔한 이름이 다른 게임과 연결되지 않게 비교하는 데 씀)
     */
    async findTitleGames(names) {
      const list = [...new Set(names.map((n) => String(n || '').replace(/["\\]/g, '').trim()).filter(Boolean))];
      if (!list.length) return [];
      // 이름(대소문자만 무시하고 정확히 같음) + 영문 이름은 slug로도 (기호·띄어쓰기가 달라도 찾게: 'KartRider: Drift' ↔ 'Kartrider Drift')
      // 조건이 많으면 IGDB가 시간 초과(504)를 내서 이름은 10개씩, slug는 따로 나눠 물음
      const fields = 'fields id,name,alternative_names.name,game_localizations.name,platforms.name';
      const queries = [];
      for (let i = 0; i < list.length; i += 10) {
        const cond = list.slice(i, i + 10).flatMap((n) => [`name ~ ${quote(n)}`, `alternative_names.name ~ ${quote(n)}`, `game_localizations.name ~ ${quote(n)}`]).join(' | ');
        queries.push(`${fields}; where ${cond}; limit 500;`);
      }
      const slugs = [...new Set(list.flatMap(titleSlugs))];
      for (let i = 0; i < slugs.length; i += 200) queries.push(`${fields}; where slug = (${slugs.slice(i, i + 200).map(quote).join(',')}); limit 500;`);
      const seen = new Set();
      const rows = (await Promise.all(queries.map((q) => query('games', q, { timeoutMs: 30_000 }))))
        .flat()
        .filter((r) => r.id == null || (!seen.has(r.id) && seen.add(r.id))); // 이름·slug 양쪽에서 걸린 같은 게임은 한 번만
      return rows.map((r) => ({
        names: [r.name, ...(r.alternative_names || []).map((a) => a.name), ...(r.game_localizations || []).map((l) => l.name)].filter(Boolean),
        platforms: platformClasses(r.platforms),
      }));
    },
    /** 이름(별칭·현지화 이름 포함)이 정확히 같은 IGDB 게임들 (게임위 등급을 받은 IGDB 게임 찾기용) */
    async findGamesByTitles(names) {
      const list = [...new Set(names.map((n) => String(n || '').replace(/["\\]/g, '').trim()).filter(Boolean))];
      if (!list.length) return [];
      const cond = list.flatMap((n) => [`name ~ ${quote(n)}`, `alternative_names.name ~ ${quote(n)}`, `game_localizations.name ~ ${quote(n)}`]).join(' | ');
      const rows = await query('games', `fields ${GAME_FIELDS}; where (${cond}) & ${MAIN_ONLY.join(' & ')}; limit 500;`, { timeoutMs: 30_000 });
      return rows.filter(isMainGame).map((r) => mark(igdbToGame(r)));
    },
    /**
     * 온라인으로 즐기는 게임(멀티·협동·MMO·배틀로얄) 중 PC·모바일·웹 게임 — 평가 수와 상관없이 (서비스 종료 확인용)
     * 평가가 없는 국내 온라인 게임(예: 넥슨 캐주얼 게임)도 포함되도록
     */
    async listOnline({ offset = 0, limit = 500, minRatings = 0 } = {}) {
      // game_modes 2 멀티 · 3 협동 · 5 MMO · 6 배틀로얄 / platforms 6 PC · 34 Android · 39 iOS · 82 웹
      const minR = Math.max(0, Number(minRatings) || 0);
      const where = `${MAIN_ONLY.join(' & ')} & game_modes = (2,3,5,6) & platforms = (6,34,39,82)${minR > 0 ? ` & total_rating_count >= ${minR}` : ''}`;
      const [rows, total] = await Promise.all([
        query('games', `fields ${GAME_FIELDS}; where ${where}; sort id asc; limit ${limit}; offset ${offset};`, { timeoutMs: 45_000 }),
        offset === 0 ? count('games', `where ${where};`) : Promise.resolve(null),
      ]);
      return { games: rows.filter(isMainGame).map((r) => mark(igdbToGame(r))), rows: rows.length, total };
    },
    async searchByTitle(title, limit = 5) {
      // 같은 게임의 다른 판(에디션·이식판 등, version_parent 가 있는 항목)은 제외
      // IGDB 검색은 띄어쓰기를 구분해서 'lostark' 로는 'Lost Ark' 가 안 나옴 →
      // 띄어 쓴 경우들을 slug(예: lost-ark)로 만들어 정확히 같은 게임을 함께 찾음
      const slugs = spacingSlugs(title);
      const [found, exact] = await Promise.all([
        query('games', `search ${quote(title)}; fields ${GAME_FIELDS}; where ${MAIN_ONLY.join(' & ')}; limit ${limit};`),
        slugs.length
          ? query('games', `fields ${GAME_FIELDS}; where slug = (${slugs.map(quote).join(',')}) & ${MAIN_ONLY.join(' & ')}; sort total_rating_count desc; limit 10;`)
          : Promise.resolve([]),
      ]);
      const seen = new Set();
      return [...exact, ...found]
        .filter((r) => !seen.has(r.id) && seen.add(r.id))
        .filter(isMainGame)
        .map((r) => mark(igdbToGame(r)));
    },
  };
}
