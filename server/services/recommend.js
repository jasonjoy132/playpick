// 기본 추천(매칭) 로직
// 각 선택 조건에 대해 게임별로 일치(match) / 불일치(mismatch) / 정보 없음(unknown)을 판정합니다.
import { PLATFORM_MAP, GENRE_MAP, PLATFORMS, GENRES } from './taxonomy.js';

const PLATFORM_VALUES = new Set(PLATFORMS.map((p) => p.value));
const GENRE_VALUES = new Set(GENRES.map((g) => g.value));

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
  const platforms = [...new Set(list(query.platforms))];
  const genres = [...new Set(list(query.genres))];
  for (const p of platforms) if (!PLATFORM_VALUES.has(p)) errors.push(`알 수 없는 플랫폼: ${p}`);
  for (const g of genres) if (!GENRE_VALUES.has(g)) errors.push(`알 수 없는 장르: ${g}`);
  if (players == null && platforms.length === 0 && genres.length === 0) {
    errors.push('인원수, 플랫폼, 장르 중 최소 한 가지 조건을 선택해 주세요.');
  }
  return { criteria: { players, platforms, genres }, errors };
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

/** a 사이사이에 b를 끼움 (a every 개마다 b 1개, 한쪽이 끝나면 나머지를 이어 붙임) */
export function interleave(a, b, every = 4) {
  const out = [];
  let j = 0;
  a.forEach((x, i) => {
    out.push(x);
    if ((i + 1) % every === 0 && j < b.length) out.push(b[j++]);
  });
  return [...out, ...b.slice(j)];
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
