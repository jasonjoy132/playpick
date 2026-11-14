// 인기 게임 순위 (/api/browse/popular?by=&sort=)
const RATING_MIN_TOTAL = 100; // 평점 합계 순위에 넣는 최소 평가 수(글로벌 평점 TOP과 같은 기준 — 평가 몇 개로 만점인 게임이 위로 오지 않게)

/**
 * 인기 게임 PlayPick·합계 순위 매기기 (글로벌은 IGDB가 정렬해 줌)
 * - 평가 수: PlayPick = 회원 리뷰 수, 합계 = 글로벌 평가 수 + 회원 리뷰 수(totalCount)
 * - 평점: PlayPick = 회원 별점 평균(같으면 평가 많은 순), 합계 = 두 평균을 평가 수만큼 가중한 평균(totalRating, 평가 합계 100개 이상)
 */
export function rankGames(games, by, sort) {
  const pc = (g) => g.userRating?.count ?? 0;
  const gc = (g) => g.globalRating?.count ?? 0;
  if (by === 'count') {
    if (sort === 'playpick') return games.filter((g) => pc(g) > 0).sort((a, b) => pc(b) - pc(a) || (b.userRating?.avg ?? 0) - (a.userRating?.avg ?? 0));
    return games.map((g) => ({ ...g, totalCount: gc(g) + pc(g) })).sort((a, b) => b.totalCount - a.totalCount);
  }
  if (sort === 'playpick') return games.filter((g) => pc(g) > 0).sort((a, b) => b.userRating.avg - a.userRating.avg || pc(b) - pc(a));
  return games
    .map((g) => {
      const gn = g.globalRating?.avg != null ? gc(g) : 0;
      const pn = g.userRating?.avg != null ? pc(g) : 0;
      const count = gn + pn;
      const exact = count ? ((gn ? (g.globalRating.exact ?? g.globalRating.avg) * gn : 0) + (pn ? g.userRating.avg * pn : 0)) / count : null;
      return { ...g, totalRating: exact == null ? null : { avg: Math.round(exact * 10) / 10, count, exact } };
    })
    .filter((g) => g.totalRating && g.totalRating.count >= RATING_MIN_TOTAL)
    .sort((a, b) => b.totalRating.exact - a.totalRating.exact || b.totalRating.count - a.totalRating.count);
}

// ── 추천 목록(나만의 게임 찾기) 정렬: 추천순(match, 기본)·평가 많은/적은 순(count/count_asc)·평점 높은/낮은 순(rating/rating_asc) ──
export const RESULT_ORDERS = ['match', 'count', 'count_asc', 'rating', 'rating_asc'];
const RATED_MIN = 50; // igdbProvider.RATED_MIN과 같게 — 평가가 이보다 적으면 평점 순에서 뒤로

/** 평가 수 합계(글로벌 + PlayPick) */
export const reviewCount = (g) => (g.globalRating?.count ?? 0) + (g.userRating?.count ?? 0);

/** 평점 합계(두 평균을 평가 수만큼 가중) — 없으면 null */
export function combinedRating(g) {
  const gn = g.globalRating?.avg != null ? g.globalRating.count ?? 0 : 0;
  const pn = g.userRating?.avg != null ? g.userRating.count ?? 0 : 0;
  if (!gn && !pn) return null;
  return ((gn ? (g.globalRating.exact ?? g.globalRating.avg) * gn : 0) + (pn ? g.userRating.avg * pn : 0)) / (gn + pn);
}

/**
 * 두 게임 비교 (음수면 a가 앞)
 * - count / count_asc: 평가 많은·적은 순 (적은 순은 평가 없는 게임을 맨 뒤)
 * - rating / rating_asc: 평가 RATED_MIN개 이상을 평점 높은·낮은 순으로 먼저, 나머지는 평가 많은 순(평점 없는 게임 맨 뒤)
 */
export function compareByOrder(a, b, order) {
  const ca = reviewCount(a);
  const cb = reviewCount(b);
  if (order === 'count') return cb - ca;
  if (order === 'count_asc') return (ca === 0) - (cb === 0) || ca - cb;
  if (order === 'rating' || order === 'rating_asc') {
    const dir = order === 'rating' ? 1 : -1;
    const ra = combinedRating(a);
    const rb = combinedRating(b);
    const rated = (cb >= RATED_MIN) - (ca >= RATED_MIN);
    if (rated) return rated;
    if (ca >= RATED_MIN) return dir * ((rb ?? 0) - (ra ?? 0)) || cb - ca;
    return (rb != null) - (ra != null) || cb - ca;
  }
  return 0;
}

/** 추천 결과({ game, evaluation }) 정렬. 비슷한 게임은 맞는 조건 수를 먼저 보고 그다음 정렬 기준 */
export function sortResults(items, order, { byMatch = false } = {}) {
  if (order === 'match') return items;
  return [...items].sort((x, y) => (byMatch ? y.evaluation.matchedCount - x.evaluation.matchedCount || x.evaluation.mismatchCount - y.evaluation.mismatchCount : 0) || compareByOrder(x.game, y.game, order));
}
