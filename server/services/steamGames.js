// IGDB·게관위에 없는 Steam 게임 — 미리 받아 둔 파일만 읽어 검색·추천·상세에 넣음
//  - 파일: server/data/steam-games.json ( `npm run import:steam` 으로 만듦, git으로 배포 )
//    { "<appid>": { game: {...}, date } | { skip: '이유', date } }
//  - 게임 id: steam-<appid>, 출처 'Steam'. 값은 Steam 상점이 준 것만(만들지 않음)
import fs from 'node:fs';
import path from 'node:path';
import { normTitle, titleKeys } from '../providers/igdbProvider.js';

const RELOAD_MS = 30_000;
const ADULT = new Set([1, 3, 4]); // Steam 성적 콘텐츠 표시(노출·성인 전용) — 친구와 고르는 사이트라 넣지 않음
// 본편이 따로 있는 맛보기·시험판·도구·영상 (IGDB에 없는 이유가 대개 이것) — 제목으로
export const NOT_FULL_GAME = /\b(prologue|prelude|demo|playtest|dev\s*test|test\s*server|free\s*sample|teaser|benchmark|tools?|sdk|modding|soundtrack|vr\s*experience|final\s*hours|starter\s*edition|free\s*trial|light\s*edition|character\s*creat(or|ion))\b|\b(alpha|beta)(\s*\d+(\.\d+)?)?\s*\)?\s*$|\b(alpha|beta)\s*\d+(\.\d+)?\b|\((alpha|beta)\)|\btutorial\s*$|체험판|프롤로그|캐릭터\s*생성|序章|试玩|試玩|测试服|體驗版|体验版/i;
// 프로그램 쪽 장르(오디오·디자인·사진·영상·웹·게임 개발·유틸리티) — 하나라도 있으면 게임이 아님(교육은 빼지 않음)
const SOFTWARE_GENRES = new Set([51, 52, 53, 55, 56, 57, 58, 59, 60]);
/** 저장된 게임이 넣을 만한 본편인지 (장르 없음·맛보기 제목은 뺌) */
// 무료로 따로 내놓은 맛보기판의 부제(유료 본편이 따로 있음) — 무료 게임일 때만 봄
const FREE_SAMPLE = /(friend\s*pass|initiation|flight\s*school|beginnings?|dojo|first\s*(breath|pints|loot|days)|chapter\s*(1|one)|bandit's\s*trail|room\s*one|rookie\s*day|foreword|foundations)\s*$/i;
// 직접 확인해 뺀 게임(성적인 내용·혐오·정치 인물 미화 등, 2026-11-23 사용자 요청) — Steam 앱 번호
export const BLOCKED_APPS = new Set(['2421310', '3404380', '3949730', '3982450', '4397180', '5035220']);
export const isFullGame = (g) =>
  !BLOCKED_APPS.has(String(g?.steamAppId)) &&
  !(g?.price?.free && FREE_SAMPLE.test(String(g.title))) &&
  Boolean(g?.genresRaw) &&!/^(무료 플레이|앞서 해보기|Free to Play|Early Access)(, (무료 플레이|앞서 해보기|Free to Play|Early Access))*$/.test(g.genresRaw) && !NOT_FULL_GAME.test(`${g.title} ${g.originalTitle ?? ''}`);
// Steam 장르 번호 → 사이트 장르
const GENRE = { 1: 'action', 2: 'strategy', 3: 'rpg', 9: 'racing', 18: 'sports', 25: 'adventure', 28: 'simulation' };
// Steam 기능 번호
const SINGLE = 2;
const MULTI = new Set([1, 9, 20, 24, 27, 36, 37, 38, 39, 44, 47, 48, 49]);
const IMG = /^https:\/\/[a-z0-9.-]*(steamstatic\.com|steampowered\.com)\//;

const plain = (html) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Steam 날짜('2022년 2월 24일', '24 Feb, 2022', '2022년 2월') → YYYY-MM-DD 또는 null */
export function steamDate(s) {
  const t = String(s ?? '');
  const ko = t.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ko) return `${ko[1]}-${ko[2].padStart(2, '0')}-${ko[3].padStart(2, '0')}`;
  const d = new Date(`${t} UTC`);
  return /\d{4}/.test(t) && !Number.isNaN(d.getTime()) && /\d{1,2}/.test(t.replace(/\d{4}/, '')) ? d.toISOString().slice(0, 10) : null;
}

/**
 * appdetails 응답(한 게임) → 사이트 게임 또는 넣지 않는 이유
 * @returns {{ game?: object, skip?: string }}
 */
export function steamToGame(appid, entry, { englishName = null, reviews = null, cover = null } = {}) {
  if (!entry?.success || !entry.data) return { skip: 'no-data' };
  const d = entry.data;
  if (d.type !== 'game') return { skip: 'not-game' };
  // 장르가 없거나 프로그램 쪽 장르가 있으면 게임이 아님 (SteamVR·에뮬레이터·DJ 연습 앱 등)
  const gids = (d.genres ?? []).map((g) => Number(g.id));
  if (!gids.some((x) => x !== 37 && x !== 70) || gids.some((x) => SOFTWARE_GENRES.has(x))) return { skip: 'not-game' };
  if (NOT_FULL_GAME.test(String(d.name ?? englishName ?? ''))) return { skip: 'not-full-game' };
  if (d.release_date?.coming_soon) return { skip: 'coming-soon' };
  if ((d.content_descriptors?.ids ?? []).some((x) => ADULT.has(Number(x)))) return { skip: 'adult' };
  const cats = (d.categories ?? []).map((c) => Number(c.id));
  const plat = d.platforms ?? {};
  const os = [plat.windows && 'Windows', plat.mac && 'macOS', plat.linux && 'Linux'].filter(Boolean);
  const genres = [...new Set((d.genres ?? []).map((g) => GENRE[Number(g.id)]).filter(Boolean))];
  const name = String(d.name ?? englishName ?? '').trim();
  if (!name) return { skip: 'no-name' };
  const singleOnly = cats.includes(SINGLE) && !cats.some((c) => MULTI.has(c));
  const shots = (d.screenshots ?? []).map((s) => s.path_full).filter((u) => IMG.test(String(u))).slice(0, 6);
  const header = IMG.test(String(d.header_image)) ? d.header_image : null;
  const url = `https://store.steampowered.com/app/${appid}`;
  const original = englishName && normTitle(englishName) !== normTitle(name) ? englishName : null;
  return {
    game: {
      id: `steam-${appid}`,
      steamAppId: String(appid),
      title: name,
      originalTitle: original,
      isDemo: false,
      source: 'Steam',
      publisher: d.publishers?.[0] || d.developers?.[0] || null,
      summary: plain(d.short_description) || null,
      platforms: os.length ? ['pc'] : null,
      platformsRaw: os.length ? `PC (${os.join(', ')})` : null,
      genres: genres.length ? genres : null,
      genresRaw: (d.genres ?? []).map((g) => g.description).join(', ') || null,
      features: (d.categories ?? []).map((c) => c.description).filter(Boolean),
      players: singleOnly ? { min: 1, max: 1 } : null,
      // 싱글 플레이 기능만 있으면 1명(Steam 기능 근거), 멀티 기능이 있으면 인원 수를 몰라 정보 없음
      recommendedPlayers: singleOnly ? { min: 1, max: 1, source: 'steam' } : null,
      gameModes: [cats.includes(SINGLE) && 'Single player', cats.some((c) => MULTI.has(c)) && 'Multiplayer'].filter(Boolean),
      rating: null,
      ratingSource: null,
      domesticRating: false,
      releaseDate: steamDate(d.release_date?.date),
      firstYear: steamDate(d.release_date?.date) ? Number(steamDate(d.release_date.date).slice(0, 4)) : null,
      imageUrl: cover ?? header,
      bannerUrl: header,
      screenshots: shots,
      screenshotSource: shots.length ? 'Steam' : null,
      imageSource: 'Steam',
      stores: [{ name: 'Steam', url, isDemo: false }],
      price: typeof d.is_free === 'boolean' ? { free: d.is_free, source: 'steam' } : undefined,
      steamReviews: Number(reviews) > 0 ? Number(reviews) : null,
      globalRating: null,
      matchNames: [...new Set([name, englishName].filter(Boolean).flatMap(titleKeys))],
    },
  };
}

/**
 * @param {string|null} file
 * @param {{ entries?: Record<string, object>, now?: () => number }} opt
 */
export function createSteamGames(file, { entries = {}, now = () => Date.now() } = {}) {
  let map = new Map(Object.entries(entries));
  let list = null;
  let mtime = 0;
  let lastCheck = 0;
  let dirty = false;
  const load = () => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m === mtime) return;
      map = new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
      list = null;
      mtime = m;
    } catch {
      /* 없거나 쓰는 중이면 그대로 */
    }
  };
  if (file) {
    load();
    lastCheck = now();
  }
  const games = () => {
    if (file && now() - lastCheck > RELOAD_MS) {
      lastCheck = now();
      load();
    }
    if (!list) list = [...map.values()].filter((e) => e?.game?.id && isFullGame(e.game)).map((e) => e.game);
    return list;
  };
  return {
    games,
    get size() {
      return games().length;
    },
    getGame: (id) => games().find((g) => g.id === id) ?? null,
    /** 제목·원제에 검색어가 들어간 게임 */
    search(query) {
      const n = normTitle(query);
      if (!n) return [];
      return games().filter((g) => g.matchNames?.some((k) => k.includes(n)) || [g.title, g.originalTitle].some((t) => t && normTitle(t).includes(n)));
    },
    has: (appid) => map.has(String(appid)),
    /** 스크립트용: 처음부터 다시 받을 때 비우기 */
    clear() {
      map = new Map();
      list = null;
      dirty = true;
    },
    set(appid, value) {
      map.set(String(appid), { ...value, date: new Date(now()).toISOString().slice(0, 10) });
      list = null;
      dirty = true;
    },
    save() {
      if (!file || !dirty) return;
      dirty = false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries([...map].sort(([a], [b]) => Number(a) - Number(b)))));
      fs.renameSync(tmp, file);
      mtime = fs.statSync(file).mtimeMs;
    },
  };
}
