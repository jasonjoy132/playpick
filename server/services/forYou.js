// '나를 위한 추천' — 회원 활동(별점·찜·최근 본 게임)으로 취향표를 만들고, 후보 게임에 점수를 매기는 콘텐츠 기반 추천
// 머신러닝 없이 규칙으로 계산 → 카드마다 이유를 한 줄로 보여 줄 수 있음

/** 활동별 가중치 (별점 1~2점은 그 장르를 덜 좋아하는 것으로) */
export const SIGNAL_WEIGHT = { love: 3, wish: 2, view: 1, dislike: -2 };
export const SIGNAL_LABEL = { love: '별점을 높게 준', wish: '찜한', view: '최근 본' };
/** 이만큼 활동이 모여야 취향 추천, 모자라면 '활동을 더 남겨 주세요' 안내와 함께 인기 게임 위주 */
export const MIN_SIGNALS = 3;

/** 별점 → 활동 종류 (3점은 보통이라 취향에 안 넣음) */
export function ratingSignal(rating) {
  if (rating >= 4) return 'love';
  if (rating <= 2) return 'dislike';
  return null;
}

const playersOf = (g) => g?.recommendedPlayers ?? g?.players ?? null;

/**
 * 취향표 만들기
 * @param {{ game: object, kind: 'love'|'wish'|'view'|'dislike' }[]} signals 같은 게임이 여러 번이면 가장 강한 활동 하나만
 */
export function buildProfile(signals) {
  const best = new Map();
  for (const s of signals) {
    if (!s.game?.id) continue;
    const prev = best.get(s.game.id);
    // 별점 활동(좋음·싫음)이 찜·최근 본보다 우선, 그다음 가중치 큰 것
    const rank = (x) => (x.kind === 'love' || x.kind === 'dislike' ? 10 : 0) + Math.abs(SIGNAL_WEIGHT[x.kind]);
    if (!prev || rank(s) > rank(prev)) best.set(s.game.id, s);
  }
  const genres = new Map();
  const platforms = new Map();
  let together = 0;
  let playersKnown = 0;
  const liked = [];
  for (const s of best.values()) {
    const w = SIGNAL_WEIGHT[s.kind];
    for (const g of s.game.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + w);
    if (w > 0) {
      for (const p of s.game.platforms ?? []) platforms.set(p, (platforms.get(p) ?? 0) + w);
      const pl = playersOf(s.game);
      if (pl?.max) {
        playersKnown += w;
        if (pl.max >= 2) together += w;
      }
      liked.push(s);
    }
  }
  for (const [g, w] of genres) if (w <= 0) genres.delete(g);
  const genreTotal = [...genres.values()].reduce((a, b) => a + b, 0);
  return {
    seen: new Set(best.keys()),
    signalCount: best.size,
    genres,
    genreTotal,
    platforms,
    /** 좋아한 게임 중 여럿이 하는 게임(추천 최대 2명 이상)의 몫 (0~1, 모르면 null) */
    togetherShare: playersKnown ? together / playersKnown : null,
    liked: liked.sort((a, b) => SIGNAL_WEIGHT[b.kind] - SIGNAL_WEIGHT[a.kind]),
  };
}

/** 취향 장르 위에서부터 n개 */
export const topGenres = (profile, n = 3) => [...profile.genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g);

/**
 * 후보 게임 점수 (높을수록 먼저)
 * - 장르: 게임 장르가 취향표에서 차지하는 몫의 합 (0~1)
 * - 플랫폼: 내가 하는 플랫폼에서 안 되면 0점(빼기)
 * - 인원: 여럿이 하는 게임을 주로 좋아했으면 여럿이 하는 게임에, 혼자 하는 게임을 좋아했으면 그쪽에 가산
 * - 인기: 너무 무명인 게임만 나오지 않게 평가 수를 조금
 */
export function scoreGame(game, profile) {
  if (profile.seen.has(game.id)) return null;
  if (profile.platforms.size && !(game.platforms ?? []).some((p) => profile.platforms.has(p))) return null;
  const genre = profile.genreTotal ? (game.genres ?? []).reduce((a, g) => a + (profile.genres.get(g) ?? 0), 0) / profile.genreTotal : 0;
  if (profile.genreTotal && genre <= 0) return null;
  const pl = playersOf(game);
  let players = 0.3;
  if (pl?.max && profile.togetherShare != null) players = pl.max >= 2 ? profile.togetherShare : 1 - profile.togetherShare;
  const count = game.globalRating?.count ?? 0;
  const popularity = Math.min(1, Math.log10(count + 1) / 4);
  return 4 * Math.min(1, genre) + players + 0.7 * popularity; // 장르가 가장 크게, 인원·인기는 같은 장르끼리 순서를 정하는 정도
}

/** 카드 아래 이유 한 줄: 장르가 가장 많이 겹치는 좋아한 게임 + 겹친 장르 + 인원 */
export function reasonFor(game, profile, genreLabel = (g) => g) {
  let anchor = null;
  let shared = [];
  for (const s of profile.liked) {
    const both = (game.genres ?? []).filter((g) => (s.game.genres ?? []).includes(g));
    if (both.length > shared.length) {
      anchor = s;
      shared = both;
    }
  }
  const pl = playersOf(game);
  const range = (lo, hi) => (lo === hi ? `${hi}명` : `${lo}~${hi}명`);
  const players = pl?.max ? (pl.max >= 2 ? range(pl.min ?? 1, pl.max) : '혼자') : null;
  if (!anchor) return players ? `${players} · 많이 평가받은 게임` : '많이 평가받은 게임';
  const genres = shared.slice(0, 2).map(genreLabel).join('·');
  return [`${SIGNAL_LABEL[anchor.kind]} 「${anchor.game.title}」처럼 ${genres}`, players].filter(Boolean).join(' · ');
}

/** 후보를 점수 순으로 골라 이유를 붙임 */
export function rankForYou(candidates, profile, { limit = 24, genreLabel } = {}) {
  const seen = new Set();
  const scored = [];
  for (const g of candidates) {
    if (!g?.id || seen.has(g.id)) continue;
    seen.add(g.id);
    const score = scoreGame(g, profile);
    if (score == null) continue;
    scored.push({ game: g, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.game.globalRating?.count ?? 0) - (a.game.globalRating?.count ?? 0));
  return scored.slice(0, limit).map(({ game }) => ({ ...game, forYouReason: reasonFor(game, profile, genreLabel) }));
}
