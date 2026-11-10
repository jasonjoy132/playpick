// Node.js(http 모듈) 기반 API 서버 + 빌드된 React 정적 파일 제공
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createCatalog } from './services/catalog.js';
import { parseCriteria, recommend, evaluateGame, compareResults, interleave } from './services/recommend.js';
import { getOptions, isOffTopic, isArcadeOnly } from './services/taxonomy.js';
import { DataSourceError } from './providers/errors.js';
import { createTranslator, withKoreanSummaries } from './services/translator.js';
import { openDb } from './db.js';
import { createAccounts } from './community/accounts.js';
import { createOAuth } from './community/oauth.js';
import { createCommunity } from './community/community.js';
import { createMailer } from './community/mailer.js';
import { createRateLimiter } from './community/rateLimit.js';
import { GAME_ID } from './community/validate.js';
import { createAvatarStore, avatarMime } from './community/avatars.js';
import { createSubmissions } from './community/submissions.js';
import { createBadges } from './community/badges.js';
import { createImageSubmissions } from './community/imageSubmissions.js';
import { createReports } from './community/reports.js';
import { createContributors } from './community/contributors.js';
import { createNotifications } from './community/notifications.js';
import { createRawgPlaytime } from './services/rawgPlaytime.js';
import { createAiPlaytime, canAskPlaytime } from './services/aiPlaytime.js';
import { createPartySize } from './services/partySize.js';
import { createAppStoreProvider } from './providers/appStoreProvider.js';
import { createGracNew, overlayEntries } from './services/gracNew.js';
import { cached } from './community/cached.js';
import { createAppArt, pickArt } from './services/appArt.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const COOKIE = 'pp_session';
const OAUTH_COOKIE = 'pp_oauth'; // 소셜 로그인 진행 중(state·돌아갈 화면), 10분
const PENDING_COOKIE = 'pp_oauth_pending'; // 처음 온 소셜 계정이 닉네임을 정하는 동안, 30분

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
const apiError = (code, message, status) => new DataSourceError(code, message, status);

function sendError(res, err) {
  if (err instanceof DataSourceError) return sendJson(res, err.status, { error: { code: err.code, message: err.message } });
  console.error('[playpick] 처리되지 않은 오류:', err?.message);
  return sendJson(res, 500, { error: { code: 'INTERNAL', message: '서버에서 오류가 발생했습니다.' } });
}

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 본문이 없어도 되는 요청 (승인 등): JSON이 아니면 빈 객체 */
const optionalJson = (req) => (String(req.headers['content-type'] || '').includes('application/json') ? readJson(req) : Promise.resolve({}));

async function readJson(req, limit = 16 * 1024) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw apiError('BAD_REQUEST', 'JSON 형식으로 보내 주세요.', 415);
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw apiError('TOO_LARGE', '요청이 너무 큽니다.', 413);
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw apiError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.', 400);
  }
}

export function createApp(config, deps = {}) {
  const catalog = deps.catalog ?? createCatalog(config, deps);
  const translator = deps.translator ?? createTranslator(config.deepl ?? {}, deps);
  // RAWG 평균 플레이 시간: 미리 받아 둔 파일만 읽음 (npm run prefill:playtime)
  const rawgTimes = deps.rawgPlaytime ?? createRawgPlaytime(config.rawg?.dataFile ?? null);
  const partySize = deps.partySize ?? createPartySize(config.gemini ?? {}, { ...deps, log: (m) => console.log(m) });
  const appArt = deps.appArt ?? createAppArt(config.appStore?.artFile ?? null);
  const appStore = deps.appStore ?? createAppStoreProvider(config.appStore ?? { enabled: config.dataSource === 'live' }, deps);
  // 회원 DB: 테스트는 메모리, 배포는 Turso(TURSO_DATABASE_URL), 로컬은 파일(.data/playpick.db)
  const dbTarget = config.dbFile === ':memory:' || !config.dbFile ? config.dbFile ?? ':memory:' : config.turso?.url || config.dbFile;
  const db = deps.db ?? openDb(dbTarget, { authToken: config.turso?.authToken });
  const baseUrl = (config.baseUrl || `http://localhost:${config.port ?? 4000}`).replace(/\/$/, '');
  const secureCookie = baseUrl.startsWith('https://');
  const mailer = deps.mailer ?? createMailer(config.mail ?? {}, deps);
  // 업로드 사진은 DB(images 표)에. 예전에 디스크(.data/avatars 등)에 저장한 사진은 로컬에서만 읽기 전용으로 보여 줌
  const legacyDir = !config.dbFile || config.dbFile === ':memory:' || config.vercel ? null : path.dirname(config.dbFile);
  const avatars = createAvatarStore(db);
  const accounts = createAccounts(db, { mailer, baseUrl, avatars });
  const oauth = deps.oauth ?? createOAuth(config.oauth ?? {}, { baseUrl, fetchImpl: deps.oauthFetch, endpoints: deps.oauthEndpoints });
  const badges = createBadges(db);
  const community = createCommunity(db, { badgeOf: async (id, cache) => await badges.displayFor(id, cache) });
  // 게임 제보 표지(s…)·표지 사진 제보(p…)
  const submissionImages = createAvatarStore(db, { prefix: 's', maxBytes: 1536 * 1024 });
  const submissions = createSubmissions(db, { images: submissionImages });
  const photoImages = createAvatarStore(db, { prefix: 'p', maxBytes: 1536 * 1024 });
  const imageSubs = createImageSubmissions(db, { images: photoImages });
  const reports = createReports(db);
  const notes = createNotifications(db, { earnedOf: async (id) => (await badges.list(id)).badges.filter((b) => b.earned) });
  /** 리뷰 목록 + 내가 신고한 리뷰 표시 */
  const reviewsOut = async (gameId, viewerId, opt) => {
    const out = await community.reviews(gameId, viewerId, opt);
    if (viewerId == null) return out;
    const mine = await reports.reportedIds(viewerId, gameId);
    return { ...out, reviews: out.reviews.map((r) => (mine.has(r.id) ? { ...r, reported: true } : r)) };
  };
  const admins = new Set((config.adminEmails ?? []).map((e) => String(e).toLowerCase()));
  const contributors = createContributors(db, { adminEmails: admins, badgeOf: async (id) => await badges.displayFor(id), notify: async (uid, n) => await notes.add(uid, n) });
  const withRole = (u) => (u ? { ...u, isAdmin: admins.has(String(u.email).toLowerCase()) } : u);
  /** 화면에 돌려주는 내 정보: 관리자 여부 + 닉네임 옆 대표 뱃지 */
  const meOut = async (u) => (u ? { ...withRole(u), badge: await badges.displayFor(u.id), newBadges: await badges.newBadges(u.id) } : u);
  /** 일반 게임 + 승인된 제보 게임(user-…) */
  const getAnyGame = async (id) => (String(id).startsWith('user-') ? await submissions.getGame(id) : catalog.getGame(id));
  const limits = {
    login: createRateLimiter({ limit: 5, windowMs: 10 * 60e3 }),
    mail: createRateLimiter({ limit: 5, windowMs: 10 * 60e3 }),
    signup: createRateLimiter({ limit: 10, windowMs: 60 * 60e3 }),
    oauth: createRateLimiter({ limit: 30, windowMs: 10 * 60e3 }),
    write: createRateLimiter({ limit: 60, windowMs: 60e3 }),
    aiPlaytime: createRateLimiter({ limit: 30, windowMs: 60 * 60e3 }), // 회원 한 명이 AI 플레이 시간을 새로 물을 수 있는 수(시간당)
  };
  // 게관위 새 게임: 하루 한 번 받아 DB에 두고(스토어 근거 + AI 인원), 색인·AI 판단에 덧붙임 (live 모드만)
  const feed = catalog.gracFeed ?? null;
  const gracNew = feed
    ? deps.gracNew ??
      createGracNew(db, {
        grac: feed.grac,
        appStore: appStore.enabled ? appStore : null,
        seedGames: feed.seedGames,
        hasFileJudgement: (g) => partySize.hasEntry?.({ ...g, source: '게임물관리위원회' }) ?? false,
        ai: { ...(config.gemini ?? {}), live: config.gracNew?.ai !== false },
        fetchImpl: deps.gracNewFetch,
        log: (m) => console.log(m),
      })
    : null;
  /** 새 게임·판단을 1분마다 다시 읽어 색인·AI 판단에 넣음 (다른 인스턴스가 수집해도 곧 반영) */
  const newGames = cached(
    async () => {
      const d = await gracNew.load();
      feed.setExtra(d.games);
      partySize.setOverlay?.(overlayEntries(d));
      return d.games.length;
    },
    { ttl: 60_000 },
  );
  const runGracNew = async () => {
    const r = await gracNew.run();
    newGames.clear();
    return r;
  };
  const aiPlaytime = deps.aiPlaytime ?? createAiPlaytime(db, config.aiPlaytime ?? {}, { ...deps, log: (m) => console.log(m) });
  // IGDB 이용자 기록 플레이 시간은 기록한 사람이 이만큼 이상일 때만 씀(적으면 한두 사람 값에 크게 흔들림)
  const IGDB_TTB_MIN = 3;
  /** 상세용: IGDB 이용자 기록 플레이 시간 (기준 인원 이상일 때만, 아니면 null) */
  async function igdbTimeToBeat(g) {
    if (g.isDemo || g.source !== 'IGDB' || !catalog.timeToBeat) return null;
    const t = await catalog.timeToBeat(g.id);
    return t && t.count >= IGDB_TTB_MIN && (t.hastily || t.normally) ? t : null;
  }
  /**
   * 평균 플레이 시간 고르기 (출처 구분)
   * 회원 정보 수정 제보 → IGDB 이용자 기록(3명 이상) → RAWG(미리 받은 파일) → AI 추정(미리 받은 파일) → AI 추정(상세에서 물어 DB에 저장한 값)
   */
  async function playtimeOf(g, ttb = null) {
    if (g.userPlaytime) return { hours: g.userPlaytime, source: 'user' };
    if (g.isDemo || g.source === '사용자 제보') return null;
    if (ttb) return { hours: ttb.normally ?? ttb.hastily, hastily: ttb.hastily, normally: ttb.normally, completely: ttb.completely, count: ttb.count, url: g.igdbUrl ?? null, source: 'igdb' };
    const r = rawgTimes.get(g.id);
    if (r) return { ...r, source: 'rawg' };
    if (g.aiPlaytime) return { hours: g.aiPlaytime, source: 'ai' };
    const asked = await aiPlaytime.cached(g.id);
    return asked ? { hours: asked, source: 'ai' } : null;
  }
  const meta = () => ({ ...catalog.meta, translation: translator.configured, mail: mailer.configured || mailer.devLog, rawg: rawgTimes.size > 0, aiPlayers: partySize.configured });
  const RESULT_PAGE = 24;
  const IGDB_SCAN = 48; // 추천 인원으로 다시 거르면 줄어드므로 한 번에 넉넉히 훑음
const SLIDES = 5;
  const distDir = path.join(config.root, 'client', 'dist');

  const cookieOf = (name, value, maxAge, cookiePath = '/') =>
    `${name}=${value ? encodeURIComponent(value) : ''}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`;
  const sessionCookie = (token, maxAge) => cookieOf(COOKIE, token, maxAge);
  const oauthCookie = (value, maxAge) => cookieOf(OAUTH_COOKIE, value, maxAge, '/api/auth/oauth');
  const pendingCookie = (value, maxAge) => cookieOf(PENDING_COOKIE, value, maxAge, '/api/auth/oauth');
  const redirect = (res, location, cookies = []) => {
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
    res.end();
  };

  /**
   * 목록·검색에 보여도 되는 게임
   *  - AI가 서비스 종료로 판단했거나, 회원 서비스 종료 제보가 승인된 게임은 숨김
   *  - 게임위 전용 게임 중 출시 예정 게임은 '출시 예정' 목록에서만 보임. 상세 페이지는 그대로 열림
   *  - 게임위 게임은 기본으로 'AI(또는 외부 AI 검토)가 서비스 중이라고 판단' 또는 'App Store에 같은 앱이 있음'일 때만 보임
   *    (상태 '모름'은 숨김. .env 에 HIDE_UNKNOWN_GRAC=off 면 '모름'도 보임)
   *    (AI 판단 데이터가 아예 없으면 — 키·정리 파일 없이 실행 — 숨기지 않음)
   */
  const hideUnknown = () => Boolean(config.hideUnknownGrac) && partySize.size > 0;
  /** 서비스가 끝난 게임: AI·외부 AI 판단, 회원 제보 승인, IGDB 상태(Offline 등) → 목록뿐 아니라 상세·찜·최근 본 게임에서도 안 보임 */
  const isEnded = (g) => Boolean(g?.aiEnded || g?.userEnded || g?.hidden);
  /**
   * 상세까지 막는 게임과 그 이유 (목록뿐 아니라 상세·찜·최근 본 게임에서도 안 보임, 관리자만 열림)
   *  - 서비스 종료(AI·외부 AI 판단·회원 제보·IGDB Offline) · 판매 중단(Delisted) · 개발 취소(Cancelled) · 아케이드 기계 전용
   * @returns {{ code: string, message: string } | null}
   */
  function blockedReason(g) {
    const st = String(g?.gameStatus ?? '').toLowerCase();
    if (g?.aiEnded || g?.userEnded || (g?.hidden && (st === 'offline' || !st))) return { code: 'ENDED', message: '서비스가 종료된 게임이에요.' };
    if (g?.hidden && st === 'delisted') return { code: 'DELISTED', message: '판매가 중단된 게임이에요.' };
    if (g?.hidden && st === 'cancelled') return { code: 'CANCELLED', message: '개발이 취소된 게임이에요.' };
    if (g?.hidden) return { code: 'ENDED', message: '지금은 할 수 없는 게임이에요.' };
    if (g && isArcadeOnly(g)) return { code: 'ARCADE', message: '오락실·인형뽑기 같은 아케이드 기계 게임이에요.' };
    return null;
  }
  /** 저장된 목록(찜·최근 본·내 리뷰)에서 서비스 종료 게임 빼기 — 저장된 id·제목으로 AI 판단·회원 제보를 확인 */
  const withoutEnded = async (items) => {
    if (!items.length) return items;
    const probe = items.map((x) => ({ id: x.gameId, title: x.title ?? '', source: String(x.gameId).startsWith('igdb-') ? 'IGDB' : String(x.gameId).startsWith('grac-') ? '게임물관리위원회' : '기타', recommendedPlayers: null }));
    const ended = new Set((await reports.applyAll(partySize.applyCached(probe))).filter(isEnded).map((g) => g.id));
    return items.filter((x) => !ended.has(x.gameId) && !(x.platforms?.length && isArcadeOnly({ platforms: x.platforms })));
  };
  const listable = (g) =>
    !g.aiEnded && !g.userEnded && !isOffTopic(g) && (g.source !== '게임물관리위원회' || (!g.aiUpcoming && (!hideUnknown() || g.aiAlive === true || g.aiRecent === true || Boolean(g.appStoreUrl))));
  const listableRaw = (g) => listable(appArt.apply(partySize.applyCached([g])[0]));

  /** 목록·상세 게임에 평균 별점·찜 여부 붙이기 */
  async function decorate(games, user) {
    const stats = await community.statsAll();
    const wished = user ? await community.wishedIds(user.id) : new Set();
    return (await reports.applyAll(await imageSubs.applyAll(appArt.applyAll(partySize.applyCached(games))))).map(({ submittedById, ...g }) => ({ ...g, userRating: stats.get(g.id) ?? { count: 0, avg: null }, wished: wished.has(g.id) }));
  }

  /**
   * IGDB 전체 검색(인원은 최대 인원으로 넓게 거름) → 추천 인원(IGDB 협동 인원/AI 추정)을 붙임
   * 추천 인원으로 다시 판정하면 줄어들 수 있어서, 일치가 12개 미만이면 한 번 더 훑음
   */
  const log = deps.log ?? ((m) => (config.timingLog === false ? null : console.log(m)));
  /** 단계별 걸린 시간을 서버 콘솔에 기록 (느린 곳 찾기용) */
  async function timed(label, fn) {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      log(`[timing]   ${label} ${Date.now() - t0}ms`);
    }
  }

  async function igdbRounds(criteria, offset) {
    let total = null;
    let pos = offset;
    let games = [];
    let warning = null;
    for (let round = 0; round < 2; round++) {
      const r = await catalog.findMatches(criteria, { offset: pos, limit: IGDB_SCAN });
      if (!r || r.failed) return round ? { games, total, hasMore: true, nextOffset: pos, warning } : r;
      if (round === 0) total = r.total;
      const f = await partySize.fill(r.games, round ? { waitMs: 3000 } : undefined);
      warning ||= f.warning;
      if (f.late) return { games: [...games, ...f.games], total, hasMore: r.hasMore, nextOffset: pos + IGDB_SCAN, warning };
      games = [...games, ...f.games];
      pos += IGDB_SCAN;
      const matched = recommend(games, criteria).fullMatches.length;
      if (!r.hasMore || matched >= 12 || pos >= 5000) return { games, total, hasMore: r.hasMore && pos < 5000, nextOffset: pos, warning };
    }
    return { games, total, hasMore: true, nextOffset: pos, warning };
  }

  /** AI가 '출시 예정'으로 판단한 게임위 게임 (최근 등급분류 순, 1분 캐시) */
  let upcomingCache = null;
  function upcomingDomestic() {
    if (upcomingCache && Date.now() - upcomingCache.at < 60_000) return upcomingCache.games;
    const games = partySize
      .applyCached(catalog.domesticGames?.() ?? [])
      .filter((g) => g.aiUpcoming && !g.aiEnded)
      .sort((a, b) => String(b.ratingDate || '').localeCompare(String(a.ratingDate || '')))
      .slice(0, 60);
    upcomingCache = { at: Date.now(), games };
    return games;
  }

  async function findGame(id) {
    if (!GAME_ID.test(id)) throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
    const game = await getAnyGame(id);
    if (!game) throw apiError('NOT_FOUND', '게임 정보를 찾을 수 없습니다.', 404);
    return game;
  }

  async function handleApi(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    // 배포(Vercel)는 프록시 뒤라서 실제 접속 IP가 x-forwarded-for 첫 값에 있음 (로컬에서는 이 헤더를 믿지 않음)
    const ip = (config.vercel && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
    if (gracNew) await newGames().catch((e) => console.log(`[grac-new] 읽기 실패: ${e.message}`));
    // Vercel Cron(하루 1번): 게관위 새 게임 수집·판단. Vercel 이 CRON_SECRET 을 Authorization 헤더로 보냄
    if (p === '/api/cron/grac' && method === 'GET') {
      if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`) throw apiError('FORBIDDEN', '허용되지 않은 요청입니다.', 401);
      if (!gracNew) return sendJson(res, 200, { ok: false, skipped: 'NOT_LIVE' });
      return sendJson(res, 200, await runGracNew());
    }
    const token = readCookies(req)[COOKIE];
    const user = withRole(await accounts.userFromToken(token));

    // 상태를 바꾸는 요청: 다른 사이트에서 보낸 요청(CSRF) 차단
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw apiError('FORBIDDEN', '허용되지 않은 요청입니다.', 403);
      if (req.headers['x-requested-with'] !== 'playpick') throw apiError('FORBIDDEN', '허용되지 않은 요청입니다.', 403);
    }
    const requireUser = () => {
      if (!user) throw apiError('LOGIN_REQUIRED', '로그인이 필요합니다.', 401);
      return user;
    };

    // ── 계정 ──
    if (p === '/api/auth/me' && method === 'GET') return sendJson(res, 200, { user: await meOut(user) });
    // ── 뱃지·칭호 ──
    if (p === '/api/me/badges' && method === 'GET') return sendJson(res, 200, await badges.list(requireUser().id));
    if (p === '/api/me/badges/seen' && method === 'POST') {
      const u = requireUser();
      return sendJson(res, 200, await badges.markSeen(u.id, (await readJson(req)).ids));
    }
    if (p === '/api/me/badges/selected' && method === 'PUT') {
      const u = requireUser();
      const { id } = await readJson(req);
      return sendJson(res, 200, await badges.select(u.id, id ?? null));
    }
    if (p === '/api/auth/signup' && method === 'POST') {
      if (!limits.signup.hit(ip)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      const { user: u, session } = await accounts.signup(await readJson(req));
      await notes.welcome(u.id, u.nickname);
      return sendJson(res, 201, { user: await meOut(u) }, { 'Set-Cookie': sessionCookie(session.token, session.maxAgeSec) });
    }
    if (p === '/api/auth/login' && method === 'POST') {
      const body = await readJson(req);
      const key = `${ip}|${String(body.loginId || '').toLowerCase()}`;
      if (!limits.login.hit(key)) throw apiError('RATE_LIMIT', '로그인 시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요.', 429);
      const { user: u, session } = await accounts.login(body);
      limits.login.reset(key);
      return sendJson(res, 200, { user: await meOut(u) }, { 'Set-Cookie': sessionCookie(session.token, session.maxAgeSec) });
    }
    if (p === '/api/auth/logout' && method === 'POST') {
      await accounts.logout(token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    // ── 다른 계정으로 로그인 (Google · Discord) ──
    if (p === '/api/auth/providers' && method === 'GET') return sendJson(res, 200, { providers: oauth.enabled });
    let om = /^\/api\/auth\/oauth\/(google|discord)\/(start|callback)$/.exec(p);
    if (om && method === 'GET') {
      const [, prov, step] = om;
      if (step === 'start') {
        const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
        const next = url.searchParams.get('next') || '/';
        const back = mode === 'link' ? '/mypage/accounts' : `/login?next=${encodeURIComponent(next)}`;
        const sep = back.includes('?') ? '&' : '?';
        if (mode === 'link' && !user) return redirect(res, `/login?next=${encodeURIComponent('/mypage/accounts')}`);
        if (!limits.oauth.hit(ip)) return redirect(res, `${back}${sep}oauthError=RATE_LIMIT`);
        if (!oauth.has(prov)) return redirect(res, `${back}${sep}oauthError=OAUTH_DISABLED&provider=${prov}`);
        const { url: to, cookie } = oauth.start(prov, { next, mode });
        return redirect(res, to, [oauthCookie(cookie, 600)]);
      }
      // callback: state 확인 → 코드를 토큰으로 → 로그인·연결·가입 대기
      const saved = oauth.readCookie(readCookies(req)[OAUTH_COOKIE]);
      const mode = saved?.mode === 'link' ? 'link' : 'login';
      const next = saved?.next || '/';
      const clear = oauthCookie('', 0);
      const back = (code) =>
        mode === 'link'
          ? `/mypage/accounts?oauthError=${code}&provider=${prov}`
          : `/login?oauthError=${code}&provider=${prov}&next=${encodeURIComponent(next)}`;
      if (url.searchParams.get('error')) return redirect(res, back('OAUTH_DENIED'), [clear]);
      if (!saved || saved.provider !== prov || saved.state !== url.searchParams.get('state')) return redirect(res, back('OAUTH_STATE'), [clear]);
      if (!limits.oauth.hit(ip)) return redirect(res, back('RATE_LIMIT'), [clear]);
      try {
        const profile = await oauth.finish(prov, url.searchParams.get('code'));
        if (mode === 'link') {
          if (!user) return redirect(res, `/login?next=${encodeURIComponent('/mypage/accounts')}`, [clear]);
          await accounts.oauthLink(user.id, profile);
          return redirect(res, `/mypage/accounts?linked=${prov}`, [clear]);
        }
        const r = await accounts.oauthLogin(profile, { next });
        if (r.pending) return redirect(res, '/signup/social', [clear, pendingCookie(r.pending.token, r.pending.maxAgeSec)]);
        return redirect(res, next, [clear, sessionCookie(r.session.token, r.session.maxAgeSec)]);
      } catch (err) {
        if (!(err instanceof DataSourceError)) console.error('[playpick:oauth] 처리 오류:', err?.message);
        return redirect(res, back(err instanceof DataSourceError ? err.code : 'OAUTH_FAILED'), [clear]);
      }
    }
    if (p === '/api/auth/oauth/pending' && method === 'GET') {
      return sendJson(res, 200, { pending: await accounts.oauthPending(readCookies(req)[PENDING_COOKIE]) });
    }
    if (p === '/api/auth/oauth/complete' && method === 'POST') {
      if (!limits.signup.hit(ip)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      const r = await accounts.oauthComplete(readCookies(req)[PENDING_COOKIE], await readJson(req));
      res.writeHead(201, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': [sessionCookie(r.session.token, r.session.maxAgeSec), pendingCookie('', 0)],
      });
      return res.end(JSON.stringify({ user: await meOut(r.user), next: r.next }));
    }
    if (p === '/api/me/identities' && method === 'GET') {
      const u = requireUser();
      return sendJson(res, 200, { items: await accounts.identities(u.id), providers: oauth.enabled, hasPassword: u.hasPassword });
    }
    om = /^\/api\/me\/identities\/(google|discord)$/.exec(p);
    if (om && method === 'DELETE') {
      const u = requireUser();
      await accounts.unlink(u.id, om[1]);
      return sendJson(res, 200, { items: await accounts.identities(u.id) });
    }
    if (p === '/api/auth/find-id' && method === 'POST') {
      if (!limits.mail.hit(ip)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      return sendJson(res, 200, await accounts.findId(await readJson(req)));
    }
    if (p === '/api/auth/reset-request' && method === 'POST') {
      if (!limits.mail.hit(ip)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      return sendJson(res, 200, await accounts.requestReset(await readJson(req)));
    }
    if (p === '/api/auth/reset' && method === 'POST') {
      if (!limits.mail.hit(`reset|${ip}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      return sendJson(res, 200, await accounts.resetPassword(await readJson(req)));
    }

    // ── 알림 ──
    if (p === '/api/me/notifications' && method === 'GET') {
      const u = requireUser();
      return sendJson(res, 200, { ...await notes.list(u.id), pending: u.isAdmin ? await notes.pendingCount() : null });
    }
    if (p === '/api/me/notifications/count' && method === 'GET') {
      const u = requireUser();
      return sendJson(res, 200, { unread: await notes.unread(u.id), pending: u.isAdmin ? await notes.pendingCount() : null });
    }
    if (p === '/api/me/notifications/read' && method === 'POST') return sendJson(res, 200, await notes.markRead(requireUser().id, await readJson(req)));

    // ── 마이페이지: 내 정보 ──
    if (p === '/api/me/profile' && method === 'PATCH') {
      const u = requireUser();
      return sendJson(res, 200, { user: await meOut(await accounts.updateProfile(u.id, await readJson(req))) });
    }
    if (p === '/api/me/avatar' && (method === 'PUT' || method === 'DELETE')) {
      const u = requireUser();
      if (!limits.write.hit(`a|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      const dataUrl = method === 'PUT' ? (await readJson(req, 1024 * 1024)).dataUrl : null;
      if (method === 'PUT' && !dataUrl) throw apiError('INVALID_IMAGE', '이미지를 선택해 주세요.', 400);
      return sendJson(res, 200, { user: await meOut(await accounts.setAvatar(u.id, dataUrl)) });
    }
    if (p === '/api/me/password' && method === 'POST') {
      const u = requireUser();
      if (!limits.login.hit(`pw|${u.id}`)) throw apiError('RATE_LIMIT', '시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요.', 429);
      return sendJson(res, 200, await accounts.changePassword(u.id, token, await readJson(req)));
    }
    if (p === '/api/me/delete' && method === 'POST') {
      // 회원 탈퇴: 검토 중인 제보 정리 → 계정 삭제(DB가 세션·찜·리뷰·알림 함께 삭제, 승인된 제보는 작성자 없이 남음)
      const u = requireUser();
      if (!limits.login.hit(`pw|${u.id}`)) throw apiError('RATE_LIMIT', '시도가 너무 많습니다. 10분 뒤 다시 시도해 주세요.', 429);
      await accounts.deleteAccount(u.id, await readJson(req), async () => {
        await submissions.removePendingOf(u.id);
        await imageSubs.removePendingOf(u.id);
        await reports.removePendingOf(u.id);
      });
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (p === '/api/me/reviews' && method === 'GET') return sendJson(res, 200, { items: await withoutEnded(await community.myReviews(requireUser().id)) });
    if (p === '/api/me/recent' && method === 'GET') return sendJson(res, 200, { items: await withoutEnded(await community.recent(requireUser().id)) });
    if (p === '/api/me/recent' && method === 'DELETE') {
      await community.clearRecent(requireUser().id);
      return sendJson(res, 200, { items: [] });
    }
    const recm = p.match(/^\/api\/me\/recent\/([^/]+)$/);
    if (recm && method === 'DELETE') {
      const u = requireUser();
      await community.removeRecent(u.id, decodeURIComponent(recm[1]));
      return sendJson(res, 200, { items: await withoutEnded(await community.recent(u.id)) });
    }

    // ── 찜 ──
    if (p === '/api/wishlist' && method === 'GET') {
      const u = requireUser();
      const stats = await community.statsAll();
      const items = (await withoutEnded(await community.wishlist(u.id))).map((w) => ({ ...w, userRating: stats.get(w.gameId) ?? { count: 0, avg: null } }));
      return sendJson(res, 200, { items });
    }
    const wm = p.match(/^\/api\/wishlist\/([^/]+)$/);
    if (wm && (method === 'PUT' || method === 'DELETE')) {
      const u = requireUser();
      if (!limits.write.hit(`w|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      const id = decodeURIComponent(wm[1]);
      if (method === 'PUT') {
        await community.addWish(u.id, await findGame(id));
        await contributors.afterReaction(id); // 내가 기여한 게임 찜 이정표
      } else await community.removeWish(u.id, id);
      return sendJson(res, 200, { gameId: id, wished: method === 'PUT' });
    }

    // ── 리뷰 ──
    const rm = p.match(/^\/api\/games\/([^/]+)\/reviews(\/mine)?$/);
    if (rm) {
      const id = decodeURIComponent(rm[1]);
      if (!rm[2] && method === 'GET') {
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        return sendJson(res, 200, await reviewsOut(id, user?.id, { limit: 20, offset }));
      }
      if (rm[2] && (method === 'PUT' || method === 'DELETE')) {
        const u = requireUser();
        if (!limits.write.hit(`r|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
        if (method === 'PUT') {
          const body = await readJson(req);
          const done = await notes.watchBadges(u.id);
          await community.saveReview(u.id, await findGame(id), body); // 존재하는 게임에만, 제목·이미지는 서버 조회값
          await done(); // 리뷰로 새 칭호를 받았으면 알림
          await contributors.afterReaction(id); // 기여자에게 첫 리뷰 알림
        } else {
          await community.deleteReview(u.id, id);
          await badges.newBadges(u.id); // 잃은 칭호를 기록에서 지워, 다시 얻으면 다시 알리게
        }
        return sendJson(res, 200, await reviewsOut(id, u.id, { limit: 20 }));
      }
    }

    // ── 게임 제보 (회원) ──
    if (p === '/api/submissions' && method === 'POST') {
      const u = requireUser();
      if (!limits.write.hit(`s|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      return sendJson(res, 201, { item: await submissions.create(u.id, await readJson(req, 2.5 * 1024 * 1024)) });
    }
    if (p === '/api/me/submissions' && method === 'GET') return sendJson(res, 200, { items: await submissions.mine(requireUser().id) });
    const smm = p.match(/^\/api\/me\/submissions\/(\d{1,9})$/);
    if (smm && method === 'DELETE') return sendJson(res, 200, await submissions.cancel(requireUser().id, smm[1]));

    // ── 표지 사진 제보 (회원) ──
    const pim = p.match(/^\/api\/games\/([^/]+)\/image-submissions$/);
    if (pim && method === 'POST') {
      const u = requireUser();
      if (!limits.write.hit(`p|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      let gid;
      try {
        gid = decodeURIComponent(pim[1]);
      } catch {
        throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
      }
      if (!GAME_ID.test(gid)) throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
      const body = await readJson(req, 2.5 * 1024 * 1024);
      const found = await getAnyGame(gid);
      const [game] = found ? await decorate([found], null) : [null]; // 이미 사진(App Store·승인된 제보 등)이 있는지 확인
      return sendJson(res, 201, { item: await imageSubs.create(u, game, body) });
    }
    if (p === '/api/me/image-submissions' && method === 'GET') return sendJson(res, 200, { items: await imageSubs.mine(requireUser().id) });
    const pmm = p.match(/^\/api\/me\/image-submissions\/(\d{1,9})$/);
    if (pmm && method === 'DELETE') return sendJson(res, 200, await imageSubs.cancel(requireUser().id, pmm[1]));

    // ── 서비스 종료·정보 수정 제보, 리뷰 신고 (회원) ──
    const grm = p.match(/^\/api\/games\/([^/]+)\/reports$/);
    if (grm && method === 'POST') {
      const u = requireUser();
      if (!limits.write.hit(`g|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      let gid;
      try {
        gid = decodeURIComponent(grm[1]);
      } catch {
        throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
      }
      if (!GAME_ID.test(gid)) throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
      const body = await readJson(req);
      const found = await getAnyGame(gid);
      const [game] = found ? await decorate([found], null) : [null];
      return sendJson(res, 201, { item: await reports.createGameReport(u, game, body) });
    }
    if (p === '/api/me/reports' && method === 'GET') return sendJson(res, 200, { items: await reports.mineGameReports(requireUser().id) });
    const mrm = p.match(/^\/api\/me\/reports\/(\d{1,9})$/);
    if (mrm && method === 'DELETE') return sendJson(res, 200, await reports.cancelGameReport(requireUser().id, mrm[1]));
    const rrm = p.match(/^\/api\/reviews\/(\d{1,12})\/report$/);
    if (rrm && method === 'POST') {
      const u = requireUser();
      if (!limits.write.hit(`rr|${u.id}`)) throw apiError('RATE_LIMIT', '잠시 후 다시 시도해 주세요.', 429);
      return sendJson(res, 201, await reports.reportReview(u.id, rrm[1], await readJson(req)));
    }

    // ── 게임 제보 관리 (관리자) ──
    if (p.startsWith('/api/admin/')) {
      const u = requireUser();
      if (!u.isAdmin) throw apiError('FORBIDDEN', '관리자만 볼 수 있어요.', 403);
      // 게관위 새 게임: 최근 목록·판단 / 지금 받기
      if (p === '/api/admin/grac-new' && method === 'GET') {
        if (!gracNew) return sendJson(res, 200, { available: false, items: [], lastRun: null });
        return sendJson(res, 200, { available: true, lastRun: await gracNew.lastRun(), items: await gracNew.recent(30) });
      }
      if (p === '/api/admin/grac-new/run' && method === 'POST') {
        if (!gracNew) throw apiError('NOT_AVAILABLE', '실제 데이터(live) 모드에서만 쓸 수 있어요.', 400);
        const r = await runGracNew();
        return sendJson(res, 200, { ...r, lastRun: await gracNew.lastRun(), items: await gracNew.recent(30) });
      }
      if (p === '/api/admin/submissions' && method === 'GET') return sendJson(res, 200, await submissions.list(url.searchParams.get('status') || 'pending'));
      const am = p.match(/^\/api\/admin\/submissions\/(\d{1,9})\/(approve|reject|edit)$/);
      if (am && method === 'POST') {
        const body = await optionalJson(req);
        if (am[2] === 'edit') return sendJson(res, 200, { item: await submissions.edit(am[1], body.edits) }); // 이미 승인된 것 고치기(알림 없음)
        const ctx = await notes.beforeReview('submission', am[1]);
        const item = am[2] === 'approve' ? await submissions.approve(am[1], u.id, body.edits) : await submissions.reject(am[1], u.id, body.reason);
        await notes.afterReview(ctx, { status: item.status, reason: item.rejectReason, adminId: u.id, gameId: item.gameId ? `/games/${item.gameId}` : null, changes: item.changes });
        return sendJson(res, 200, { item });
      }
      if (p === '/api/admin/reports' && method === 'GET') return sendJson(res, 200, await reports.listGameReports(url.searchParams.get('kind') || 'ended', url.searchParams.get('status') || 'pending'));
      const arm = p.match(/^\/api\/admin\/reports\/(\d{1,9})\/(approve|reject|edit)$/);
      if (arm && method === 'POST') {
        const body = await optionalJson(req);
        if (arm[2] === 'edit') return sendJson(res, 200, { item: await reports.editGameReport(arm[1], body.edits) });
        const ctx = await notes.beforeReview('report', arm[1]);
        const item = arm[2] === 'approve' ? await reports.approveGameReport(arm[1], u.id, body.edits) : await reports.rejectGameReport(arm[1], u.id, body.reason);
        await notes.afterReview(ctx, { status: item.status, reason: item.rejectReason, adminId: u.id, changes: item.changes });
        return sendJson(res, 200, { item });
      }
      if (p === '/api/admin/review-reports' && method === 'GET') return sendJson(res, 200, await reports.listReviewReports(url.searchParams.get('status') || 'pending'));
      const avm = p.match(/^\/api\/admin\/review-reports\/(\d{1,12})\/(hide|dismiss|restore)$/);
      if (avm && method === 'POST') {
        const ctx = await notes.beforeReviewAction(avm[1]);
        const out = await reports.resolveReview(avm[1], u.id, avm[2]);
        await notes.afterReviewAction(ctx, avm[2]);
        return sendJson(res, 200, out);
      }
      if (p === '/api/admin/image-submissions' && method === 'GET') return sendJson(res, 200, await imageSubs.list(url.searchParams.get('status') || 'pending'));
      const aim = p.match(/^\/api\/admin\/image-submissions\/(\d{1,9})\/(approve|reject)$/);
      if (aim && method === 'POST') {
        const ctx = await notes.beforeReview('image', aim[1]);
        const item = aim[2] === 'approve' ? await imageSubs.approve(aim[1], u.id) : await imageSubs.reject(aim[1], u.id, (await readJson(req)).reason);
        await notes.afterReview(ctx, { status: item.status, reason: item.rejectReason, adminId: u.id });
        return sendJson(res, 200, { item });
      }
      return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '요청한 API를 찾을 수 없습니다.' } });
    }

    // 상세 화면 AI 플레이 시간: 로그인한 회원이 플레이 시간 없는 게임을 열면 그 자리에서 물어 저장(다음부터는 저장된 값)
    const ptm = p.match(/^\/api\/games\/([^/]+)\/playtime$/);
    if (ptm && method === 'POST') {
      const u = requireUser();
      let id;
      try {
        id = decodeURIComponent(ptm[1]);
      } catch {
        throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
      }
      const [g] = await decorate([await findGame(id)], u);
      const known = await playtimeOf(g, await igdbTimeToBeat(g).catch(() => null));
      if (known) return sendJson(res, 200, { playtime: known, status: 'known' });
      if (!canAskPlaytime(g)) return sendJson(res, 200, { playtime: null, status: 'none' });
      if (await aiPlaytime.cached(g.id) !== undefined) return sendJson(res, 200, { playtime: null, status: 'cached' }); // AI가 모른다고 한 게임
      if (!aiPlaytime.enabled) return sendJson(res, 200, { playtime: null, status: 'off' });
      if (!limits.aiPlaytime.hit(`t|${u.id}`)) return sendJson(res, 200, { playtime: null, status: 'limit' });
      const r = await aiPlaytime.ask(g, u.id);
      return sendJson(res, 200, { playtime: r.hours ? { hours: r.hours, source: 'ai' } : null, status: r.status });
    }

    if (method !== 'GET') throw apiError('NOT_FOUND', '요청한 API를 찾을 수 없습니다.', 404);

    // ── 게임 데이터 ──
    if (p === '/api/health') return sendJson(res, 200, { ok: true, ...meta() });
    if (p === '/api/options') return sendJson(res, 200, { meta: meta(), ...getOptions() });

    if (p === '/api/recommendations') {
      const { criteria, errors } = parseCriteria(Object.fromEntries(url.searchParams));
      if (errors.length) return sendJson(res, 400, { error: { code: 'INVALID_CRITERIA', message: errors.join(' ') } });
      const num = (k) => Math.min(Math.max(0, Math.floor(Number(url.searchParams.get(k)) || 0)), 50_000);
      const offset = Math.min(num('offset'), 5000); // IGDB 위치
      const goffset = num('goffset'); // 게임위(IGDB에 없는 게임) 위치
      const more = url.searchParams.get('more'); // null(첫 요청) | 'full' | 'partial'
      const started = Date.now();
      // 게임위 게임(IGDB에 없는 것)을 어느 섹션의 '더 보기'와 함께 불러올지: 인원을 안 골랐으면 대부분 '모든 조건 일치',
      // 골랐으면 AI 추천 인원을 모르는 게임이 많아 '일부 조건 일치' 쪽. 받은 뒤에는 실제 판정 결과대로 두 섹션에 나눔
      const gracTo = criteria.players == null ? 'full' : 'partial';
      const wantIgdb = !more || more === 'full';
      const wantGrac = !more || more === gracTo;
      const gracLimit = gracTo === 'full' ? (more === 'full' && url.searchParams.get('igdbDone') === '1' ? RESULT_PAGE : 6) : RESULT_PAGE;
      // 1) 모든 조건 일치: IGDB 전체에서 필터 검색  2) 일부 일치: 인기 후보에서 판정(첫 요청만)  3) IGDB에 없는 게임위 게임
      const [paged, pool, grac] = await Promise.all([
        wantIgdb && url.searchParams.get('igdbDone') !== '1' ? timed('IGDB+AI', () => igdbRounds(criteria, offset)) : Promise.resolve({ games: [], total: null, hasMore: false, skipped: true }),
        !more ? timed('인기 후보', () => catalog.listGames(criteria)) : Promise.resolve(null),
        // 게임위 게임 AI 추천 인원도 IGDB 쪽과 동시에 물음 (기다리는 시간이 겹치게)
        wantGrac
          ? timed('게임위+AI', async () => {
              const r = await catalog.gracMatches(criteria, { offset: goffset, limit: gracLimit, keep: listableRaw });
              if (!r.items?.length) return r;
              const f = await partySize.fill(r.items.map((x) => x.game));
              return { ...r, games: f.games, aiWarning: f.warning };
            }).catch((e) => ({ status: 'error', error: e.message }))
          : Promise.resolve(null),
      ]);
      log(`[timing] /api/recommendations ${more ? `more=${more}` : '첫 요청'} 전체 ${Date.now() - started}ms`);
      if (paged && !paged.failed) {
        const warnings = [...(pool?.warnings ?? [])];
        if (paged.warning) warnings.push(paged.warning);
        if (grac?.status === 'building')
          warnings.push(`게임물관리위원회 전체 목록을 준비하는 중이라(${grac.progress ? `${grac.progress.done}/${grac.progress.total}` : '시작'}) IGDB에 없는 국내 게임은 아직 빠져 있어요. 몇 분 뒤 다시 찾아 주세요.`);
        if (grac?.status === 'error') warnings.push(`IGDB에 없는 국내 등급분류 게임을 불러오지 못했어요${grac.error ? ` (${grac.error})` : ''}.`);
        // 게임위 게임: AI 추천 인원을 붙인 뒤 다시 판정 → 모두 일치면 위 섹션, 아니면 아래 섹션
        const gGames = grac?.games ?? (grac?.items ?? []).map((x) => x.game);
        if (grac?.aiWarning && !warnings.includes(grac.aiWarning)) warnings.push(grac.aiWarning);
        // 승인된 회원 제보 게임도 첫 요청에 함께 판정
        const userGames = more ? [] : await submissions.approvedGames();
        const gResults = (await decorate([...userGames, ...gGames], user))
          .filter(listable) // 서비스 종료·출시 예정·상태 모름(게임위) 게임 빼기
          .map((game) => ({ game, evaluation: evaluateGame(game, criteria) }))
          .filter((x) => x.evaluation.matchedCount > 0 || x.game.source !== '사용자 제보');
        const gFull = gResults.filter((x) => x.evaluation.isFullMatch);
        const gPartial = gResults.filter((x) => !x.evaluation.isFullMatch);
        const igdbFull = recommend((await decorate(paged.games, user)).filter(listable), criteria).fullMatches;
        const poolPartial = pool ? recommend((await decorate(pool.games, user)).filter(listable), criteria).partialMatches : [];
        const fullMatches = interleave(igdbFull, gFull);
        const partialMatches = more ? gPartial : [...poolPartial, ...gPartial].sort(compareResults);
        const igdbHasMore = paged.skipped ? false : paged.hasMore;
        const gracHasMore = !!grac?.hasMore;
        return sendJson(res, 200, {
          meta: meta(), warnings, criteria, paged: true, gracTo,
          fullMatches, partialMatches,
          totalFull: paged.total, // IGDB 기준 개수(첫 요청만)
          igdbDone: !igdbHasMore,
          hasMoreFull: igdbHasMore || (gracTo === 'full' && gracHasMore),
          hasMorePartial: gracTo === 'partial' && gracHasMore,
          next: { offset: paged.skipped ? offset : paged.nextOffset, goffset: grac?.nextOffset ?? goffset },
        });
      }
      const { games: listed, warnings } = pool ?? (await catalog.listGames(criteria));
      const games = [...await submissions.approvedGames(), ...listed];
      const { fullMatches, partialMatches } = recommend((await decorate(games, user)).filter(listable), criteria);
      if (paged?.failed) warnings.unshift(`IGDB 전체 검색에 실패해 (${paged.failed.message}) 인기 게임 후보 안에서만 찾았어요.`);
      return sendJson(res, 200, { meta: meta(), warnings, criteria, paged: false, totalGames: games.length, fullMatches: more ? [] : fullMatches, partialMatches: more ? [] : partialMatches });
    }

    if (p === '/api/featured') {
      const { games: all, warnings } = await catalog.featured();
      const games = partySize.applyCached(all).filter((g) => listable(appArt.apply(g))); // 서비스 종료·출시 예정·상태 모름(게임위) 빼기
      const slides = await withKoreanSummaries(translator, games.slice(0, SLIDES));
      return sendJson(res, 200, { meta: meta(), games: await decorate([...slides, ...games.slice(SLIDES)], user), slideCount: Math.min(SLIDES, games.length), warnings });
    }

    // ── 메뉴별 목록 ──
    const bm = p.match(/^\/api\/browse\/(popular|recent|upcoming|top|genre)$/);
    if (bm) {
      const offset = Math.min(Math.max(0, Number(url.searchParams.get('offset')) || 0), 480);
      const genre = url.searchParams.get('genre') || undefined;
      const platform = url.searchParams.get('platform') || undefined;
      const opts = getOptions();
      if (genre && !opts.genres.some((g) => g.value === genre)) throw apiError('BAD_REQUEST', '알 수 없는 장르입니다.', 400);
      if (platform && !opts.platforms.some((x) => x.value === platform)) throw apiError('BAD_REQUEST', '알 수 없는 플랫폼입니다.', 400);
      if (bm[1] === 'genre' && !genre) throw apiError('BAD_REQUEST', '장르를 골라 주세요.', 400);
      const kind = bm[1] === 'genre' ? 'popular' : bm[1];
      const { games, hasMore, warnings } = await catalog.browse(kind, { genre, platform, offset });
      // 출시 예정: IGDB 기대작 + 국내 등급분류는 받았지만 아직 안 나온 게임위 게임(AI 판단, 첫 페이지에만)
      let domestic;
      if (kind === 'upcoming' && offset === 0) {
        domestic = (await decorate(upcomingDomestic(), user)).filter((g) => !platform || g.platforms?.includes(platform));
      }
      return sendJson(res, 200, { meta: meta(), games: (await decorate(games, user)).filter(listable), hasMore, nextOffset: offset + 24, warnings, domestic });
    }
    if (p === '/api/contributors' && method === 'GET') {
      const board = await contributors.leaderboard({ period: url.searchParams.get('period') || 'month' });
      return sendJson(res, 200, { ...board, me: user ? await contributors.mine(user.id) : null });
    }
    if (p === '/api/me/impact' && method === 'GET') {
      const u = requireUser();
      return sendJson(res, 200, { ...await contributors.impact(u.id), rank: await contributors.mine(u.id) });
    }
    if (p === '/api/ranking/members') {
      const top = await community.topRated({ minCount: 1, limit: 50 });
      const extra = new Map((await catalog.getMany(top.map((g) => g.id))).map((g) => [g.id, g]));
      const games = top.map((g) => ({ ...(extra.get(g.id) ?? {}), ...g, imageUrl: extra.get(g.id)?.imageUrl ?? g.imageUrl, title: extra.get(g.id)?.title ?? g.title }));
      const ranked = (await decorate(games, user)).map((g, i) => ({ ...g, userRating: top[i].userRating }));
      return sendJson(res, 200, { meta: meta(), games: ranked.filter((g) => !blockedReason(g)), warnings: [] });
    }

    if (p === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 1 || q.length > 50) return sendJson(res, 400, { error: { code: 'INVALID_QUERY', message: '검색어는 1~50자로 입력해 주세요.' } });
      const translate = translator.translateTitles ? (texts, target) => translator.translateTitles(texts, target) : undefined;
      const found = await catalog.search(q, { translate });
      const mine = [...await submissions.search(q), ...(found.translatedQuery ? await submissions.search(found.translatedQuery) : [])];
      const ids = new Set(mine.map((g) => g.id));
      const games = [...mine, ...found.games.filter((g) => !ids.has(g.id))];
      // AI가 서비스 종료라고 판단한 게임위 게임은 숨김
      return sendJson(res, 200, { meta: meta(), query: q, alsoSearched: found.translatedQuery ?? null, games: (await decorate(games, user)).filter(listable), warnings: found.warnings });
    }

    const m = p.match(/^\/api\/games\/([^/]+)$/);
    if (m) {
      let id;
      try {
        id = decodeURIComponent(m[1]);
      } catch {
        throw apiError('BAD_ID', '잘못된 게임 ID입니다.', 400);
      }
      const found = await getAnyGame(id);
      const ttbP = found ? igdbTimeToBeat(found).catch(() => null) : null; // 번역 등과 동시에
      if (!found) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '게임 정보를 찾을 수 없습니다.' } });
      const [withParty] = (await partySize.fill([found])).games;
      const [decorated] = await decorate(await withKoreanSummaries(translator, [withParty]), user);
      const blocked = blockedReason(decorated);
      if (blocked && !user?.isAdmin) return sendJson(res, 410, { error: blocked });
      if (found.source === '사용자 제보') decorated.submitterBadge = await badges.displayFor(found.submittedById); // 제보자 닉네임 옆 뱃지
      if (decorated.imageSource === '사용자 제보' && decorated.imageBy) decorated.imageByBadge = await badges.displayFor(await imageSubs.submitterOf(decorated.id));
      const playtime = await playtimeOf(decorated, await ttbP);
      // 플레이 시간이 아무 데도 없고 AI에게 아직 안 물어본 게임 → 화면이 따로 물어봄(로그인한 회원만, POST …/playtime)
      const playtimeAsk = !playtime && canAskPlaytime(decorated) && aiPlaytime.enabled && await aiPlaytime.cached(decorated.id) === undefined;
      let game = { ...decorated, playtime, playtimeAsk, playtimeAvailable: rawgTimes.size > 0 };
      // 게임위 전용 게임: App Store에서 같은 앱(제목+개발사 일치)을 찾으면 아이콘·App Store 링크 보완
      // (목록과 같은 미리 받아 둔 아이콘은 decorate 에서 이미 붙음. 확인한 적 없는 게임만 그 자리에서 찾아봄)
      if (game.source === '게임물관리위원회' && !game.imageUrl && !game.isDemo && !appArt.has(game)) {
        try {
          const app = await appStore.lookup({ title: game.title, publisher: game.publisher });
          if (app) {
            const art = pickArt(app);
            game = {
              ...game,
              imageUrl: art.cover ?? game.imageUrl,
              iconUrl: art.icon,
              bannerUrl: game.bannerUrl ?? art.banner,
              screenshots: art.screenshots,
              screenshotSource: 'App Store',
              imageSource: art.cover ? 'App Store' : null,
              appStoreUrl: app.storeUrl,
              stores: [...game.stores, { name: 'App Store', url: app.storeUrl, isDemo: false, appStore: true }],
            };
          }
        } catch {
          /* App Store 조회 실패: 기존 정보로 표시 */
        }
      }
      game.canSubmitImage = imageSubs.canTake(game); // 사진이 끝내 없으면 '표지 사진 제보' 버튼
      if (user) await community.recordView(user.id, game); // 최근 본 게임
      await contributors.recordView(game.id, user ? `u${user.id}` : `ip${ip}`, user?.id ?? null, Boolean(user?.isAdmin)); // 기여한 게임 조회 수
      const { criteria, errors } = parseCriteria(Object.fromEntries(url.searchParams));
      const evaluation = errors.length ? null : evaluateGame(game, criteria);
      return sendJson(res, 200, { meta: meta(), game, criteria: evaluation ? criteria : null, evaluation });
    }

    return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '요청한 API를 찾을 수 없습니다.' } });
  }

  async function serveAvatar(res, url, store = avatars, prefix = '/avatars/') {
    let file;
    try {
      file = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      file = '';
    }
    const headers = { 'Content-Type': avatarMime(file), 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'" };
    const img = await store.read(file);
    if (img) {
      res.writeHead(200, { ...headers, 'Content-Type': img.mime });
      return res.end(img.data);
    }
    // 로컬: 예전에 디스크에 저장한 사진(읽기만)
    const old = legacyDir && store.fileRe.test(file) ? path.join(legacyDir, prefix === '/avatars/' ? 'avatars' : 'submission-images', file) : null;
    if (old && fs.existsSync(old)) {
      res.writeHead(200, headers);
      return fs.createReadStream(old).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  function serveStatic(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      rel = '/';
    }
    const file = path.normalize(path.join(distDir, rel));
    const inside = file.startsWith(distDir + path.sep);
    if (inside && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    const index = path.join(distDir, 'index.html');
    if (!fs.existsSync(index)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('클라이언트가 빌드되지 않았습니다. `npm run build` 를 먼저 실행하세요.');
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    fs.createReadStream(index).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { code: 'METHOD', message: '허용되지 않은 요청입니다.' } });
      if (url.pathname.startsWith('/avatars/')) return await serveAvatar(res, url);
      if (url.pathname.startsWith('/submission-images/')) return await serveAvatar(res, url, /\/p\d/.test(url.pathname) ? photoImages : submissionImages, '/submission-images/');
      return serveStatic(req, res, url);
    } catch (err) {
      return sendError(res, err);
    }
  });
  server.on('close', () => {
    if (!deps.db) db.close();
  });
  server.catalog = catalog;
  /** 로컬 서버 시작 때: 마지막 수집이 하루 넘었으면 백그라운드로 한 번 (배포는 Vercel Cron) */
  server.runGracNewIfStale = async () => {
    if (!gracNew || config.vercel) return;
    try {
      const last = await gracNew.lastRun();
      if (last && Date.now() - Date.parse(last.last_at) < 86_400_000) return;
      await runGracNew();
    } catch (e) {
      console.log(`[grac-new] 실패: ${e.message}`);
    }
  };
  return server;
}
