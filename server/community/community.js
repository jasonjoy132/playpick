// 찜 목록, 별점·리뷰
import { DataSourceError } from '../providers/errors.js';
import { GAME_ID } from './validate.js';
import { avatarUrl } from './accounts.js';

const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
const MAX_REVIEW = 1000;
const MAX_RECENT = 30;

export function createCommunity(db, { now = () => Date.now(), badgeOf } = {}) {
  const q = {
    wishList: db.prepare('SELECT game_id, title, image_url, platforms, is_demo, created_at FROM wishlist WHERE user_id = ? ORDER BY created_at DESC'),
    wishIds: db.prepare('SELECT game_id FROM wishlist WHERE user_id = ?'),
    wishAdd: db.prepare('INSERT OR REPLACE INTO wishlist (user_id, game_id, title, image_url, platforms, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    wishDel: db.prepare('DELETE FROM wishlist WHERE user_id = ? AND game_id = ?'),
    // 신고로 숨긴 리뷰는 작성자 본인에게만 보임
    reviews: db.prepare(`SELECT r.id, r.rating, r.content, r.created_at, r.updated_at, r.user_id, u.nickname, u.avatar_file,
                         r.hidden_at
                         FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.game_id = ? AND (r.hidden_at IS NULL OR r.user_id = ?) ORDER BY r.created_at DESC LIMIT ? OFFSET ?`),
    mineOne: db.prepare('SELECT id FROM reviews WHERE user_id = ? AND game_id = ?'),
    myReviews: db.prepare('SELECT id, game_id, game_title, game_image, rating, content, created_at, hidden_at FROM reviews WHERE user_id = ? ORDER BY created_at DESC'),
    recentUpsert: db.prepare(`INSERT INTO recent_views (user_id, game_id, title, image_url, is_demo, viewed_at) VALUES (?, ?, ?, ?, ?, ?)
                              ON CONFLICT(user_id, game_id) DO UPDATE SET title = excluded.title, image_url = excluded.image_url, viewed_at = excluded.viewed_at`),
    recentPrune: db.prepare(`DELETE FROM recent_views WHERE user_id = ? AND game_id NOT IN
                             (SELECT game_id FROM recent_views WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ${MAX_RECENT})`),
    recentList: db.prepare('SELECT game_id, title, image_url, is_demo, viewed_at FROM recent_views WHERE user_id = ? ORDER BY viewed_at DESC'),
    recentDel: db.prepare('DELETE FROM recent_views WHERE user_id = ? AND game_id = ?'),
    recentClear: db.prepare('DELETE FROM recent_views WHERE user_id = ?'),
    stats: db.prepare('SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE game_id = ? AND hidden_at IS NULL'),
    dist: db.prepare('SELECT rating, COUNT(*) AS n FROM reviews WHERE game_id = ? AND hidden_at IS NULL GROUP BY rating'),
    insert: db.prepare('INSERT INTO reviews (user_id, game_id, rating, content, created_at, updated_at, game_title, game_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    del: db.prepare('DELETE FROM reviews WHERE user_id = ? AND game_id = ?'),
    all: db.prepare('SELECT game_id, COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE hidden_at IS NULL GROUP BY game_id'),
    top: db.prepare(`SELECT game_id, COUNT(*) AS count, AVG(rating) AS avg, MAX(game_title) AS title, MAX(game_image) AS image
                     FROM reviews WHERE hidden_at IS NULL GROUP BY game_id HAVING COUNT(*) >= ? ORDER BY AVG(rating) DESC, COUNT(*) DESC, MAX(created_at) DESC LIMIT ?`),
  };
  const statsFor = (gameId) => {
    const s = q.stats.get(gameId);
    return { count: Number(s.count), avg: s.count ? Math.round(Number(s.avg) * 10) / 10 : null };
  };
  const checkId = (gameId) => {
    if (!GAME_ID.test(gameId)) throw fail('BAD_ID', '잘못된 게임 ID입니다.');
  };

  return {
    wishlist(userId) {
      return q.wishList.all(userId).map((r) => ({
        gameId: r.game_id,
        title: r.title,
        imageUrl: r.image_url,
        platforms: r.platforms ? JSON.parse(r.platforms) : null,
        isDemo: Boolean(r.is_demo),
        addedAt: r.created_at,
      }));
    },
    wishedIds(userId) {
      return new Set(q.wishIds.all(userId).map((r) => r.game_id));
    },
    /** game: 서버가 조회한 게임 정보(브라우저가 보낸 값을 믿지 않음) */
    addWish(userId, game) {
      checkId(game.id);
      q.wishAdd.run(userId, game.id, game.title, game.imageUrl ?? null, game.platforms ? JSON.stringify(game.platforms) : null, game.isDemo ? 1 : 0, new Date(now()).toISOString());
    },
    removeWish(userId, gameId) {
      checkId(gameId);
      q.wishDel.run(userId, gameId);
    },

    stats: statsFor,
    /** 회원 평점 랭킹 (평균 별점 높은 순, 같으면 평가 많은 순) */
    topRated({ minCount = 1, limit = 50 } = {}) {
      return q.top.all(minCount, limit).map((r) => ({
        id: r.game_id,
        title: r.title || r.game_id,
        imageUrl: r.image,
        isDemo: r.game_id.startsWith('demo-'),
        userRating: { count: Number(r.count), avg: Math.round(Number(r.avg) * 10) / 10 },
      }));
    },
    /** 리뷰가 있는 모든 게임의 평균 별점 Map (목록 카드용, 한 번의 쿼리) */
    statsAll() {
      return new Map(q.all.all().map((r) => [r.game_id, { count: Number(r.count), avg: Math.round(Number(r.avg) * 10) / 10 }]));
    },
    reviews(gameId, viewerId, { limit = 20, offset = 0 } = {}) {
      checkId(gameId);
      const badgeCache = new Map();
      const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const r of q.dist.all(gameId)) dist[r.rating] = Number(r.n);
      return {
        stats: { ...statsFor(gameId), distribution: dist },
        reviews: q.reviews.all(gameId, viewerId ?? -1, limit, offset).map((r) => ({
          id: r.id,
          nickname: r.nickname,
          badge: badgeOf ? badgeOf(r.user_id, badgeCache) : null, // 닉네임 옆 대표 뱃지
          avatarUrl: avatarUrl(r.avatar_file),
          rating: r.rating,
          content: r.content,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          mine: viewerId != null && r.user_id === viewerId,
          hidden: Boolean(r.hidden_at), // (내 리뷰만) 신고로 숨겨짐
        })),
      };
    },
    /** 리뷰 작성 (1인 1리뷰, 작성 후 수정 불가 — 삭제 후 다시 작성) */
    saveReview(userId, game, { rating, content }) {
      checkId(game.id);
      const n = Number(rating);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw fail('INVALID_INPUT', '별점은 1~5점 중에서 골라 주세요.');
      const text = String(content ?? '').trim();
      if (text.length > MAX_REVIEW) throw fail('INVALID_INPUT', `리뷰는 ${MAX_REVIEW}자 이하로 작성해 주세요.`);
      if (q.mineOne.get(userId, game.id)) throw fail('ALREADY_REVIEWED', '이미 이 게임에 리뷰를 남겼어요. 리뷰는 수정할 수 없고, 삭제한 뒤 다시 작성할 수 있어요.', 409);
      const t = new Date(now()).toISOString();
      q.insert.run(userId, game.id, n, text, t, t, game.title, game.imageUrl ?? null);
      return statsFor(game.id);
    },
    myReviews(userId) {
      return q.myReviews.all(userId).map((r) => ({
        id: r.id,
        gameId: r.game_id,
        title: r.game_title || r.game_id,
        imageUrl: r.game_image,
        rating: r.rating,
        content: r.content,
        createdAt: r.created_at,
        hidden: Boolean(r.hidden_at),
      }));
    },

    /** 최근 본 게임 (사용자별 최근 30개) */
    recordView(userId, game) {
      if (!GAME_ID.test(game.id)) return;
      q.recentUpsert.run(userId, game.id, game.title, game.imageUrl ?? null, game.isDemo ? 1 : 0, new Date(now()).toISOString());
      q.recentPrune.run(userId, userId);
    },
    recent(userId) {
      return q.recentList.all(userId).map((r) => ({ gameId: r.game_id, title: r.title, imageUrl: r.image_url, isDemo: Boolean(r.is_demo), viewedAt: r.viewed_at }));
    },
    removeRecent(userId, gameId) {
      q.recentDel.run(userId, gameId);
    },
    clearRecent(userId) {
      q.recentClear.run(userId);
    },
    deleteReview(userId, gameId) {
      checkId(gameId);
      q.del.run(userId, gameId);
      return statsFor(gameId);
    },
  };
}
