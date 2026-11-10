// 알림: 제보 승인·거절, 리뷰 숨김, 새 칭호, 찜한 게임 서비스 종료, 가입 환영
// - 일이 생길 때 서버가 넣고(저장), 화면은 헤더 종 버튼에서 받아 봄
// - 사용자마다 최근 KEEP 개만 남김
import { DataSourceError } from '../providers/errors.js';

const KEEP = 100;
const LIST = 30;
const fail = (code, message, status = 400) => new DataSourceError(code, message, status);

/** 제보 종류별: 이름·테이블 */
const TYPES = {
  submission: { label: '게임 제보', sql: 'SELECT user_id, status, title, NULL AS game_id, NULL AS kind FROM game_submissions WHERE id = ?' },
  image: { label: '표지 사진 제보', sql: 'SELECT user_id, status, game_title AS title, game_id, NULL AS kind FROM image_submissions WHERE id = ?' },
  report: { label: '제보', sql: 'SELECT user_id, status, game_title AS title, game_id, kind FROM game_reports WHERE id = ?' },
};
const REPORT_LABEL = { ended: '서비스 종료 제보', fix: '정보 수정 제보' };

/**
 * @param {object} opt
 * @param {(userId:number) => {id:string,name:string}[]} [opt.earnedOf]  지금 가진 뱃지(새 칭호 알림용)
 */
export function createNotifications(db, { now = () => Date.now(), earnedOf = () => [] } = {}) {
  const q = {
    insert: db.prepare('INSERT INTO notifications (user_id, kind, tone, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    prune: db.prepare(`DELETE FROM notifications WHERE user_id = ? AND id NOT IN
                       (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ${KEEP})`),
    list: db.prepare(`SELECT id, kind, tone, title, body, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ${LIST}`),
    unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL'),
    readAll: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL'),
    readOne: db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL'),
    review: db.prepare('SELECT user_id, game_id, game_title, hidden_at FROM reviews WHERE id = ?'),
    wishers: db.prepare('SELECT user_id FROM wishlist WHERE game_id = ?'),
    pending: db.prepare(`SELECT
      (SELECT COUNT(*) FROM game_submissions WHERE status = 'pending') +
      (SELECT COUNT(*) FROM image_submissions WHERE status = 'pending') +
      (SELECT COUNT(*) FROM game_reports WHERE status = 'pending') +
      (SELECT COUNT(DISTINCT review_id) FROM review_reports WHERE status = 'pending') AS n`),
  };
  const iso = () => new Date(now()).toISOString();
  const typeQ = Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, db.prepare(t.sql)]));
  const quote = (t) => `‘${t}’`;

  async function add(userId, { kind, tone = 'info', title, body = null, link = null }) {
    if (userId == null) return;
    await q.insert.run(userId, kind, tone, String(title).slice(0, 120), body ? String(body).slice(0, 300) : null, link, iso());
    await q.prune.run(userId, userId);
  }

  const earnedIds = async (userId) => (userId == null ? new Set() : new Set((await earnedOf(userId)).map((b) => b.id)));

  /** 새로 받은 칭호 알림 (before: 일이 생기기 전 가진 뱃지 id) */
  async function badgeDiff(userId, before) {
    if (userId == null) return;
    for (const b of await earnedOf(userId)) {
      if (!before.has(b.id)) await add(userId, { kind: 'badge', tone: 'badge', title: `새 칭호 ‘${b.name}’을(를) 받았어요`, body: '뱃지·칭호에서 대표 칭호로 고를 수 있어요.', link: '/mypage/badges' });
    }
  }

  return {
    add,
    async list(userId) {
      const items = (await q.list.all(userId)).map((r) => ({
        id: r.id,
        kind: r.kind,
        tone: r.tone,
        title: r.title,
        body: r.body,
        link: r.link,
        createdAt: r.created_at,
        read: r.read_at != null,
      }));
      return { items, unread: Number((await q.unread.get(userId)).n) };
    },
    unread: async (userId) => Number((await q.unread.get(userId)).n),
    /** ids: 읽은 알림 id 목록, all: 모두 읽음 */
    async markRead(userId, { ids, all } = {}) {
      const at = iso();
      if (all) await q.readAll.run(at, userId);
      else if (Array.isArray(ids)) {
        for (const id of ids.slice(0, 100)) {
          const n = Number(id);
          if (Number.isInteger(n) && n > 0) await q.readOne.run(at, userId, n);
        }
      } else throw fail('BAD_REQUEST', '읽을 알림을 골라 주세요.');
      return { ok: true, unread: Number((await q.unread.get(userId)).n) };
    },
    /** 관리자: 검토를 기다리는 제보·신고 수 */
    pendingCount: async () => Number((await q.pending.get()).n),

    async welcome(userId, nickname) {
      await add(userId, { kind: 'welcome', tone: 'info', title: `${nickname}님, 플레이픽에 오신 걸 환영해요!`, body: '인원·플랫폼을 골라 친구들과 같이 할 게임을 찾아보세요.', link: '/' });
    },

    /**
     * 제보 처리 전에 부름: 제보한 사람·이전 상태·가진 뱃지를 기억
     * @param {'submission'|'image'|'report'} type
     */
    async beforeReview(type, id) {
      const r = await typeQ[type]?.get(Number(id));
      if (!r) return null;
      return { type, id: Number(id), userId: r.user_id, prev: r.status, title: r.title, gameId: r.game_id, kind: r.kind, before: await earnedIds(r.user_id) };
    },
    /** 제보 처리 뒤에 부름: 제보한 사람(본인 처리 제외)과 필요하면 찜한 사람에게 알림 */
    async afterReview(ctx, { status, reason, adminId, gameId, changes = [] }) {
      if (!ctx || ctx.prev === status) return;
      const label = ctx.type === 'report' ? REPORT_LABEL[ctx.kind] ?? '제보' : TYPES[ctx.type].label;
      const link = gameId ?? (ctx.gameId ? `/games/${ctx.gameId}` : '/mypage/submissions');
      if (ctx.userId != null && ctx.userId !== adminId) {
        if (status === 'approved') {
          const body = { submission: '플레이픽에 게임이 추가됐어요. 고마워요!', image: '게임 카드와 상세 화면에 표지로 나와요. 고마워요!', report: '게임 정보에 반영됐어요. 고마워요!' }[ctx.type];
          if (changes.length) {
            // 관리자가 일부 고쳐서 승인: 무엇이 바뀌었는지 함께
            const what = changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(', ');
            await add(ctx.userId, { kind: ctx.type, tone: 'ok', title: `${quote(ctx.title)} ${label}가 일부 수정되어 승인됐어요`, body: `관리자가 고친 내용: ${what}`, link });
          } else await add(ctx.userId, { kind: ctx.type, tone: 'ok', title: `${quote(ctx.title)} ${label}가 승인됐어요`, body, link });
        } else if (status === 'rejected') {
          const was = ctx.prev === 'approved' ? '승인이 취소됐어요' : '거절됐어요';
          await add(ctx.userId, { kind: ctx.type, tone: 'no', title: `${quote(ctx.title)} ${label}가 ${was}`, body: reason ? `사유: ${reason}` : null, link: '/mypage/submissions' });
        }
        await badgeDiff(ctx.userId, ctx.before);
      }
      // 서비스 종료가 확인되면 그 게임을 찜한 회원에게 (제보한 사람 제외)
      if (ctx.type === 'report' && ctx.kind === 'ended' && status === 'approved' && ctx.gameId) {
        for (const { user_id: uid } of await q.wishers.all(ctx.gameId)) {
          if (uid === ctx.userId) continue;
          await add(uid, { kind: 'wish', tone: 'warn', title: `찜한 ${quote(ctx.title)}의 서비스가 종료됐어요`, body: '회원 제보를 관리자가 확인했어요. 이제 목록과 찜 목록에 보이지 않아요.', link: '/mypage/wishlist' });
        }
      }
    },

    /** 리뷰 신고 처리 전·후 (숨김·다시 보이기만 작성자에게 알림) */
    async beforeReviewAction(reviewId) {
      const r = await q.review.get(Number(reviewId));
      return r ? { userId: r.user_id, gameId: r.game_id, title: r.game_title || r.game_id, hidden: Boolean(r.hidden_at) } : null;
    },
    async afterReviewAction(ctx, action) {
      if (!ctx) return;
      const link = `/games/${ctx.gameId}`;
      if (action === 'hide' && !ctx.hidden) {
        await add(ctx.userId, { kind: 'review', tone: 'no', title: `${quote(ctx.title)}에 남긴 리뷰가 숨김 처리됐어요`, body: '신고를 관리자가 확인했어요. 숨긴 리뷰는 나에게만 보이고 평점·칭호 계산에서 빠져요.', link });
      } else if (action === 'restore' && ctx.hidden) {
        // 숨기는 동안 잃었다 되찾은 칭호는 따로 알리지 않음
        await add(ctx.userId, { kind: 'review', tone: 'ok', title: `${quote(ctx.title)}에 남긴 리뷰가 다시 보이게 됐어요`, body: '평점·칭호 계산에도 다시 들어가요.', link });
      }
    },

    /** 리뷰 작성 등 내가 한 일로 칭호가 생겼을 때 */
    watchBadges: async (userId) => {
      const before = await earnedIds(userId);
      return async () => await badgeDiff(userId, before);
    },
  };
}
