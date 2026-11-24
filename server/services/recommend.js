// 기본 추천(매칭) 로직
// 각 선택 조건에 대해 게임별로 일치(match) / 불일치(mismatch) / 정보 없음(unknown)을 판정합니다.
import { PLATFORM_MAP, GENRE_MAP, PLATFORMS, GENRES, SELECTABLE_PLATFORMS } from './taxonomy.js';

const PLATFORM_VALUES = new Set(PLATFORMS.map((p) => p.value));
const GENRE_VALUES = new Set(GENRES.map((g) => g.value));
const PRICE_VALUES = new Set(['free', 'paid']);

/** 유료·무료: 게임에 붙은 price(스토어·AI 추정)로 판정, 없으면 정보 없음 */
function priceStatus(game, want) {
  if (typeof game.price?.free !== 'boolean') return 'unknown';
  return game.price.free === (want === 'free') ? 'match' : 'mismatch';
}

/** 쿼리 문자열 → 검증된 조건 객체. 잘못된 값은 오류로 반환 */
export function parseCriteria(query) {
  const errors = [];
  const list = (v) =>
    (Array.isArray(v) ? v.join(',') : v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  let players = null;
  if (query.players != null && query.players !== '') {
    const n = Number(query.players);
    if (!Number.isInteger(n) || n < 1 || n > 5) errors.push('players 값은 1~5 사이의 정수여야 합니다.');
    else players = n;
  }
  // 고를 수 없게 된 플랫폼(아케이드)은 예전 링크에 있어도 오류 대신 조용히 뺌
  const platforms = [...new Set(list(query.platforms))].filter((p) => SELECTABLE_PLATFORMS.has(p) || !PLATFORM_VALUES.has(p));
  const genres = [...new Set(list(query.genres))];
  for (const p of platforms) if (!PLATFORM_VALUES.has(p)) errors.push(`알 수 없는 플랫폼: ${p}`);
  for (const g of genres) if (!GENRE_VALUES.has(g)) errors.push(`알 수 없는 장르: ${g}`);
  // 유료·무료(free | paid): 혼자서는 조건이 되지 않음(인원·플랫폼·장르와 함께)
  let price = null;
  if (query.price != null && query.price !== '') {
    if (PRICE_VALUES.has(query.price)) price = query.price;
    else errors.push('price 값은 free 또는 paid 여야 합니다.');
  }
  if (players == null && platforms.length === 0 && genres.length === 0) {
    errors.push('인원수, 플랫폼, 장르 중 최소 한 가지 조건을 선택해 주세요.');
  }
  return { criteria: { players, platforms, genres, price }, errors };
}

function playersStatus(game, n) {
  // 추천 인원이 있으면 그것으로 판정 (IGDB 게임은 키가 항상 있음: null = 아직 모름 → 정보 없음)
  const p = 'recommendedPlayers' in game ? game.recommendedPlayers : game.players;
  if (!p || p.min == null || p.max == null) return 'unknown';
  if (n >= 5) return p.max >= 5 ? 'match' : 'mismatch'; // '5명 이상'
  return p.min <= n && n <= p.max ? 'match' : 'mismatch';
}

function listStatus(gameValues, selected) {
  if (!gameValues || gameValues.length === 0) return 'unknown';
  return selected.some((v) => gameValues.includes(v)) ? 'match' : 'mismatch';
}

/** 한 게임에 대한 조건별 판정 결과 */
export function evaluateGame(game, criteria) {
  const checks = [];
  if (criteria.players != null) {
    checks.push({ key: 'players', label: '인원수', status: playersStatus(game, criteria.players) });
  }
  if (criteria.platforms.length) {
    const status = listStatus(game.platforms, criteria.platforms);
    const matched = status === 'match' ? criteria.platforms.filter((v) => game.platforms.includes(v)) : [];
    checks.push({ key: 'platforms', label: '플랫폼', status, matched: matched.map((v) => PLATFORM_MAP[v].label) });
  }
  if (criteria.genres.length) {
    const status = listStatus(game.genres, criteria.genres);
    const matched = status === 'match' ? criteria.genres.filter((v) => game.genres.includes(v)) : [];
    checks.push({ key: 'genres', label: '장르', status, matched: matched.map((v) => GENRE_MAP[v].label) });
  }
  if (criteria.price) {
    checks.push({ key: 'price', label: '유료·무료', status: priceStatus(game, criteria.price), ...(game.price?.source === 'ai' ? { ai: true } : {}) });
  }
  const count = (s) => checks.filter((c) => c.status === s).length;
  const matchedCount = count('match');
  return {
    checks,
    matchedCount,
    mismatchCount: count('mismatch'),
    unknownCount: count('unknown'),
    totalCount: checks.length,
    isFullMatch: matchedCount === checks.length,
  };
}

/**
 * 추천 목록 생성
 *  - 모든 선택 조건이 일치 → fullMatches
 *  - 하나 이상 일치(나머지는 불일치/정보 없음) → partialMatches
 *  - 일치하는 조건이 하나도 없으면 제외
 * 정렬: 일치 수 ↓ → 불일치 수 ↑ → 국내 등급분류 게임 우선 → 제목(가나다)
 */
export function compareResults(a, b) {
  return (
    b.evaluation.matchedCount - a.evaluation.matchedCount ||
    a.evaluation.mismatchCount - b.evaluation.mismatchCount ||
    (a.game.domesticRating === false) - (b.game.domesticRating === false) ||
    a.game.title.localeCompare(b.game.title, 'ko')
  );
}

/** 추천 목록 순서 점수: IGDB 평가 수 + PlayPick 회원 평가 수 (게관위·회원 제보 게임은 회원 평가 수만) */
export const popularity = (g) => (g.globalRating?.count ?? 0) + (g.userRating?.count ?? 0);

/** 둘 다 점수 큰 순인 a·b를 합침 (같으면 a 먼저) */
export function mergeByPopularity(a, b) {
  const out = [];
  let j = 0;
  for (const x of a) {
    while (j < b.length && popularity(b[j].game) > popularity(x.game)) out.push(b[j++]);
    out.push(x);
  }
  return [...out, ...b.slice(j)];
}

/** 점수 큰 순 (같으면 원래 순서) */
export const byPopularity = (items) => items.map((x, i) => [x, i]).sort((p, q) => popularity(q[0].game) - popularity(p[0].game) || p[1] - q[1]).map(([x]) => x);

/** 비슷한 게임: 맞는 조건 많은 순 → 틀린 조건 적은 순 → 점수 큰 순 */
export function compareSimilar(a, b) {
  return b.evaluation.matchedCount - a.evaluation.matchedCount || a.evaluation.mismatchCount - b.evaluation.mismatchCount || popularity(b.game) - popularity(a.game);
}

export function recommend(games, criteria) {
  const scored = games
    .map((game) => ({ game, evaluation: evaluateGame(game, criteria) }))
    .filter((r) => r.evaluation.matchedCount > 0)
    .sort(compareResults);
  return {
    fullMatches: scored.filter((r) => r.evaluation.isFullMatch),
    partialMatches: scored.filter((r) => !r.evaluation.isFullMatch),
  };
}
