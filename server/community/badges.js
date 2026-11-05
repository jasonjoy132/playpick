// 명예 보상: 게임 제보·리뷰 뱃지·칭호
//  - 따로 저장하지 않고 '승인된 제보'와 그 게임의 찜·리뷰 수, 내가 쓴 리뷰로 그때그때 계산
//    (관리자가 제보 게임을 내리거나 리뷰를 지우면 자동으로 다시 계산)
import { DataSourceError } from '../providers/errors.js';
//  - 회원이 고른 대표 칭호(users.title_badge)만 저장. 고르지 않았거나 더는 자격이 없으면 가장 높은 단계 칭호를 대신 표시
export const TIERS = [
  { id: 'finder', name: '첫 발견자', icon: '🔍', need: 1, tier: 1, desc: '제보한 게임 1개가 승인됐어요' },
  { id: 'digger', name: '게임 발굴단', icon: '⛏️', need: 3, tier: 2, desc: '제보한 게임 3개가 승인됐어요' },
  { id: 'hunter', name: '정보 사냥꾼', icon: '🏹', need: 10, tier: 3, desc: '제보한 게임 10개가 승인됐어요' },
  { id: 'explorer', name: '숨은 게임 탐험가', icon: '🧭', need: 30, tier: 4, desc: '제보한 게임 30개가 승인됐어요' },
  { id: 'curator', name: '플레이픽 큐레이터', icon: '👑', need: 50, tier: 5, desc: '제보한 게임 50개가 승인됐어요' },
];
// 리뷰 단계 칭호 (게임마다 리뷰 1개라 같은 게임으로 늘릴 수 없음)
export const REVIEW_TIERS = [
  { id: 'rv1', name: '새내기 리뷰어', icon: '✍️', need: 1, tier: 1, desc: '첫 리뷰를 남겼어요' },
  { id: 'rv2', name: '한줄 평론가', icon: '💬', need: 5, tier: 2, desc: '게임 5개에 리뷰를 남겼어요' },
  { id: 'rv3', name: '게임 리뷰어', icon: '🎙️', need: 20, tier: 3, desc: '게임 20개에 리뷰를 남겼어요' },
  { id: 'rv4', name: '베테랑 평론가', icon: '📰', need: 50, tier: 4, desc: '게임 50개에 리뷰를 남겼어요' },
  { id: 'rv5', name: '전설의 평론가', icon: '🏆', need: 100, tier: 5, desc: '게임 100개에 리뷰를 남겼어요' },
];
// 표지 사진 제보 단계 칭호
export const PHOTO_TIERS = [
  { id: 'ph1', name: '스냅샷', icon: '📷', need: 1, tier: 1, desc: '제보한 표지 사진 1개가 승인됐어요' },
  { id: 'ph2', name: '표지 수집가', icon: '🖼️', need: 5, tier: 2, desc: '제보한 표지 사진 5개가 승인됐어요' },
  { id: 'ph3', name: '갤러리 큐레이터', icon: '🎞️', need: 20, tier: 3, desc: '제보한 표지 사진 20개가 승인됐어요' },
];
// 정보 제보 단계 칭호: 승인된 서비스 종료·정보 수정 제보 수 (게임마다 종류별 1번만 셈)
export const INFO_TIERS = [
  { id: 'if1', name: '정보 지킴이', icon: '🛡️', need: 1, tier: 1, desc: '서비스 종료·정보 수정 제보 1개가 승인됐어요' },
  { id: 'if2', name: '팩트 체커', icon: '✅', need: 5, tier: 2, desc: '서비스 종료·정보 수정 제보 5개가 승인됐어요' },
  { id: 'if3', name: '플레이픽 감수자', icon: '📚', need: 20, tier: 3, desc: '서비스 종료·정보 수정 제보 20개가 승인됐어요' },
];
export const LONG_REVIEW = 100; // 정성 리뷰 기준 글자 수
export const SPECIALS = [
  { id: 'pioneer', name: '개척자', icon: '🚩', desc: '내가 제보한 게임에 다른 회원의 리뷰가 달렸어요', need: 1, stat: 'reviewedGames' },
  { id: 'popular', name: '인기 발굴가', icon: '💖', desc: '내가 제보한 게임들이 다른 회원에게 찜 20개를 받았어요', need: 20, stat: 'wishes' },
  { id: 'thorough', name: '꼼꼼한 기록가', icon: '📝', desc: '표지·구매처·소개·추천 인원을 모두 채운 제보 5개가 승인됐어요', need: 5, stat: 'complete' },
  { id: 'local', name: '국내 게임 지킴이', icon: '🇰🇷', desc: '모바일 게임 제보 5개가 승인됐어요', need: 5, stat: 'local' },
  { id: 'early', name: '얼리 어답터', icon: '🌱', desc: '2026년 안에 첫 제보가 승인됐어요', need: 1, stat: 'early' },
  { id: 'essay', name: '정성 리뷰어', icon: '📖', desc: `${LONG_REVIEW}자 넘는 리뷰를 10개 남겼어요`, need: 10, stat: 'longReviews', track: 'review' },
  { id: 'cleaner', name: '클린 지킴이', icon: '🧹', desc: '내가 신고한 리뷰 3개가 관리자 확인으로 숨겨졌어요', need: 3, stat: 'upheldReports', track: 'review' },
  { id: 'firstword', name: '길잡이', icon: '🌟', desc: '아무도 리뷰하지 않은 게임에 첫 리뷰를 3번 남겼어요', need: 3, stat: 'firstReviews', track: 'review' },
];
export const EARLY_UNTIL = '2027-01-01';
const ALL = [
  ...TIERS.map((b) => ({ ...b, kind: 'tier', track: 'submit', stat: 'approved' })),
  ...REVIEW_TIERS.map((b) => ({ ...b, kind: 'tier', track: 'review', stat: 'reviews' })),
  ...PHOTO_TIERS.map((b) => ({ ...b, kind: 'tier', track: 'photo', stat: 'photos' })),
  ...INFO_TIERS.map((b) => ({ ...b, kind: 'tier', track: 'info', stat: 'reports' })),
  ...SPECIALS.map((b) => ({ track: 'submit', ...b, kind: 'special' })),
];
const BY_ID = new Map(ALL.map((b) => [b.id, b]));
// 뱃지 그림: client/public/badge-<id>.webp (없으면 화면에서 이모지 icon 으로 대신)
const pub = (b) => b && { id: b.id, name: b.name, icon: b.icon, image: b.noImage ? null : `/badge-${b.id}.webp`, kind: b.kind, track: b.track, tier: b.tier ?? null };

export function createBadges(db) {
  const q = {
    approved: db.prepare(`SELECT id, platforms, store_url, summary, image_file, players_min, reviewed_at FROM game_submissions WHERE user_id = ? AND status = 'approved'`),
    selected: db.prepare('SELECT title_badge FROM users WHERE id = ?'),
    seen: db.prepare('SELECT badges_seen FROM users WHERE id = ?'),
    setSeen: db.prepare('UPDATE users SET badges_seen = ? WHERE id = ?'),
    reviews: db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN length(content) >= ${LONG_REVIEW} THEN 1 ELSE 0 END) AS long FROM reviews WHERE user_id = ? AND hidden_at IS NULL`),
    // 그 게임의 가장 먼저 쓴 리뷰가 내 것 (지워진 리뷰는 남아 있지 않으므로 지금 남은 리뷰 기준)
    firsts: db.prepare(`SELECT COUNT(*) AS n FROM reviews r WHERE r.user_id = ? AND r.hidden_at IS NULL AND NOT EXISTS
      (SELECT 1 FROM reviews o WHERE o.game_id = r.game_id AND o.hidden_at IS NULL AND (o.created_at < r.created_at OR (o.created_at = r.created_at AND o.id < r.id)))`),
    select: db.prepare('UPDATE users SET title_badge = ? WHERE id = ?'),
    photos: db.prepare(`SELECT COUNT(DISTINCT game_id) AS n FROM image_submissions WHERE user_id = ? AND status = 'approved'`),
    reports: db.prepare(`SELECT COUNT(DISTINCT kind || ':' || game_id) AS n FROM game_reports WHERE user_id = ? AND status = 'approved'`),
    upheld: db.prepare(`SELECT COUNT(*) AS n FROM review_reports WHERE reporter_id = ? AND status = 'upheld'`),
  };
  const countIn = (sql, ids, userId) => (ids.length ? Number(db.prepare(sql.replace('(?)', `(${ids.map(() => '?').join(',')})`)).get(...ids, userId).n) : 0);

  /** 회원의 제보 실적 */
  function stats(userId) {
    const rows = q.approved.all(userId);
    const ids = rows.map((r) => `user-${r.id}`);
    const rv = q.reviews.get(userId);
    return {
      reviews: Number(rv.n),
      longReviews: Number(rv.long ?? 0),
      firstReviews: Number(q.firsts.get(userId).n),
      approved: rows.length,
      photos: Number(q.photos.get(userId).n),
      reports: Number(q.reports.get(userId).n),
      upheldReports: Number(q.upheld.get(userId).n),
      complete: rows.filter((r) => r.image_file && r.store_url && r.summary && r.players_min != null).length,
      local: rows.filter((r) => JSON.parse(r.platforms).some((p) => p === 'mobile' || p === 'arcade')).length,
      early: rows.some((r) => r.reviewed_at && r.reviewed_at < EARLY_UNTIL) ? 1 : 0,
      wishes: countIn('SELECT COUNT(*) AS n FROM wishlist WHERE game_id IN (?) AND user_id != ?', ids, userId),
      reviewedGames: countIn('SELECT COUNT(DISTINCT game_id) AS n FROM reviews WHERE game_id IN (?) AND user_id != ? AND hidden_at IS NULL', ids, userId),
    };
  }

  /** 전체 뱃지 목록 + 받았는지 + 진행도 */
  function list(userId) {
    const s = stats(userId);
    const badges = ALL.map((b) => ({ ...pub(b), desc: b.desc, need: b.need, have: Math.min(s[b.stat], b.need), earned: s[b.stat] >= b.need }));
    const earned = new Set(badges.filter((b) => b.earned).map((b) => b.id));
    const chosen = q.selected.get(userId)?.title_badge ?? null;
    // 자동 칭호: 제보·리뷰·사진·정보 단계 중 가장 높은 것 (같으면 제보 > 리뷰 > 사진 > 정보)
    const topOf = (list) => [...list].reverse().find((t) => earned.has(t.id));
    const top = [topOf(TIERS), topOf(REVIEW_TIERS), topOf(PHOTO_TIERS), topOf(INFO_TIERS)].filter(Boolean).reduce((a, b) => (!a || b.tier > a.tier ? b : a), null);
    const display = pub(BY_ID.get(chosen && earned.has(chosen) ? chosen : top?.id));
    const nextOf = (list, stat) => {
      const t = list.find((x) => !earned.has(x.id));
      return t ? { ...pub(BY_ID.get(t.id)), need: t.need, have: s[stat] } : null;
    };
    // 최근 획득: 알림을 확인한 순서(badges_seen 끝쪽이 최근) 중 지금도 가진 것 3개
    let seenOrder = [];
    try {
      seenOrder = JSON.parse(q.seen.get(userId)?.badges_seen ?? '[]');
    } catch {
      seenOrder = [];
    }
    const unseen = [...earned].filter((id) => !seenOrder.includes(id)); // 아직 알림 확인 전 = 가장 최근
    const recent = [...unseen, ...[...seenOrder].reverse().filter((id) => earned.has(id))].slice(0, 3).map((id) => pub(BY_ID.get(id)));
    return {
      badges,
      recent,
      earnedCount: earned.size,
      totalCount: badges.length,
      selected: chosen && earned.has(chosen) ? chosen : null,
      display: display ?? null,
      stats: s,
      next: nextOf(TIERS, 'approved'),
      nextReview: nextOf(REVIEW_TIERS, 'reviews'),
      nextPhoto: nextOf(PHOTO_TIERS, 'photos'),
      nextInfo: nextOf(INFO_TIERS, 'reports'),
    };
  }

  return {
    list,
    /**
     * 새로 받은 뱃지 (알림용). 알림을 확인하기 전까지 계속 돌려줌. 잃었다가 다시 얻으면 다시 알림
     * 처음(기록 없음)에는 지금 가진 뱃지를 '이미 봄'으로 기록하고 알리지 않음
     */
    newBadges(userId) {
      const { badges } = list(userId);
      const earned = badges.filter((b) => b.earned);
      const raw = q.seen.get(userId)?.badges_seen;
      if (raw == null) {
        q.setSeen.run(JSON.stringify(earned.map((b) => b.id)), userId);
        return [];
      }
      let seen;
      try {
        seen = new Set(JSON.parse(raw));
      } catch {
        seen = new Set();
      }
      // 잃은 뱃지(리뷰 삭제·제보 게임 내림 등)는 '봄' 기록에서 지워, 다시 얻으면 다시 알림
      const earnedIds = new Set(earned.map((b) => b.id));
      const kept = [...seen].filter((id) => earnedIds.has(id));
      if (kept.length !== seen.size) q.setSeen.run(JSON.stringify(kept), userId);
      return earned.filter((b) => !seen.has(b.id)).map(({ have, need, earned: _e, ...b }) => b);
    },
    /** 알림 확인: 받은 뱃지 중 ids 를 '봄'으로 */
    markSeen(userId, ids) {
      const earned = new Set(list(userId).badges.filter((b) => b.earned).map((b) => b.id));
      let seen = [];
      try {
        seen = JSON.parse(q.seen.get(userId)?.badges_seen ?? '[]');
      } catch {
        seen = [];
      }
      const next = [...new Set([...seen, ...(Array.isArray(ids) ? ids : []).filter((id) => earned.has(id))])];
      q.setSeen.run(JSON.stringify(next), userId);
      return { ok: true };
    },
    /** 닉네임 옆에 달 대표 뱃지 (없으면 null). cache(Map)를 주면 한 요청 안에서 같은 회원은 한 번만 계산 */
    displayFor(userId, cache) {
      if (userId == null) return null;
      if (!cache) return list(userId).display;
      if (!cache.has(userId)) cache.set(userId, list(userId).display);
      return cache.get(userId);
    },
    /** 대표 칭호 고르기 (받은 뱃지만, null 이면 자동) */
    select(userId, id) {
      if (id != null) {
        const mine = list(userId).badges.find((b) => b.id === id);
        if (!mine) throw new DataSourceError('BAD_BADGE', '알 수 없는 뱃지예요.', 400);
        if (!mine.earned) throw new DataSourceError('BAD_BADGE', '아직 받지 않은 뱃지예요.', 400);
      }
      q.select.run(id ?? null, userId);
      return list(userId);
    },
  };
}
