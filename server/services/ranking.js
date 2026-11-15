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
