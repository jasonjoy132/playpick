// 표지 사진 제보: 사진이 없는 게임(주로 게관위 전용 게임)에 회원이 사진을 제보 → 관리자 승인 → 카드·상세에 표시
//  - 로그인한 회원만. 출처(공식 스토어·공식 사이트 등 사진을 확인할 수 있는 주소)를 함께 받아 관리자가 확인
//  - 이미 사진이 있는 게임(IGDB·App Store 등)은 받지 않음. 승인된 사진이 여러 개면 가장 최근 승인본 사용
//  - 관리자가 직접 올리면 바로 승인
import { DataSourceError } from '../providers/errors.js';
import { imageUrlOf } from './submissions.js';
import { cached } from './cached.js';

const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
export const MAX_PENDING_IMAGES = 20;
export const IMAGE_SUBMITTED = '사용자 제보';

/** 출처 주소: http(s)만, 300자 이내 */
export function validateSourceUrl(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw fail('INVALID_IMAGE_SUBMISSION', '사진을 확인할 수 있는 출처 주소(공식 스토어·공식 사이트 등)를 넣어 주세요.');
  if (s.length > 300) throw fail('INVALID_IMAGE_SUBMISSION', '출처 주소가 너무 길어요.');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw fail('INVALID_IMAGE_SUBMISSION', '출처 주소가 올바르지 않아요.');
  }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw fail('INVALID_IMAGE_SUBMISSION', '출처는 http(s) 주소만 넣을 수 있어요.');
  return u.href;
}

export function createImageSubmissions(db, { images, now = () => Date.now() }) {
  const q = {
    insert: db.prepare(`INSERT INTO image_submissions (user_id, game_id, game_title, image_file, source_url, status, created_at, reviewed_at, reviewed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT i.*, u.nickname FROM image_submissions i LEFT JOIN users u ON u.id = i.user_id WHERE i.id = ?'),
    mine: db.prepare('SELECT * FROM image_submissions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100'),
    pendingCount: db.prepare(`SELECT COUNT(*) AS n FROM image_submissions WHERE user_id = ? AND status = 'pending'`),
    minePending: db.prepare(`SELECT id FROM image_submissions WHERE user_id = ? AND game_id = ? AND status = 'pending'`),
    byStatus: db.prepare('SELECT i.*, u.nickname FROM image_submissions i LEFT JOIN users u ON u.id = i.user_id WHERE i.status = ? ORDER BY i.created_at DESC, i.id DESC LIMIT 200'),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM image_submissions GROUP BY status'),
    approved: db.prepare(`SELECT i.*, u.nickname FROM image_submissions i LEFT JOIN users u ON u.id = i.user_id WHERE i.status = 'approved' ORDER BY i.reviewed_at, i.id`),
    setStatus: db.prepare('UPDATE image_submissions SET status = ?, reject_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM image_submissions WHERE id = ?'),
  };
  const iso = () => new Date(now()).toISOString();
  // game_id → { imageUrl, by, byId, sourceUrl }
  const approvedMap = cached(async () => {
    const map = new Map();
    for (const r of await q.approved.all()) map.set(r.game_id, { imageUrl: imageUrlOf(r.image_file), by: r.nickname ?? null, byId: r.user_id, sourceUrl: r.source_url });
    return map;
  }, { now });
  const changed = () => approvedMap.clear();

  const toItem = (r) => ({
    id: r.id,
    status: r.status,
    gameId: r.game_id,
    gameTitle: r.game_title,
    imageUrl: imageUrlOf(r.image_file),
    sourceUrl: r.source_url,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    submitter: r.nickname ?? null,
  });

  /** 사진을 받을 수 있는 게임인지 (실제 게임, 사진 없음, 제보 게임 아님) */
  const canTake = (game) => Boolean(game && !game.isDemo && !game.imageUrl && !String(game.id).startsWith('user-'));

  return {
    canTake,
    /** 회원 제보 (game: 서버에서 다시 조회·꾸민 게임) */
    async create(user, game, input) {
      if (!game) throw fail('NOT_FOUND', '게임을 찾을 수 없어요.', 404);
      if (!canTake(game)) throw fail('HAS_IMAGE', '이미 사진이 있는 게임이에요.', 409);
      const sourceUrl = validateSourceUrl(input?.sourceUrl);
      if (!input?.image) throw fail('INVALID_IMAGE_SUBMISSION', '사진을 올려 주세요.');
      if (!user.isAdmin) {
        if ((await q.pendingCount.get(user.id)).n >= MAX_PENDING_IMAGES) throw fail('TOO_MANY', `검토 중인 사진 제보가 ${MAX_PENDING_IMAGES}개 있어요. 결과가 나온 뒤 다시 제보해 주세요.`, 429);
        if (await q.minePending.get(user.id, game.id)) throw fail('DUPLICATE', '이 게임에 검토 중인 사진 제보가 이미 있어요.', 409);
      }
      const file = await images.save(user.id, input.image);
      const status = user.isAdmin ? 'approved' : 'pending'; // 관리자는 바로 등록
      const at = iso();
      const { lastInsertRowid } = await q.insert.run(user.id, game.id, String(game.title).slice(0, 120), file, sourceUrl, status, at, user.isAdmin ? at : null, user.isAdmin ? user.id : null);
      if (user.isAdmin) changed();
      return toItem(await q.byId.get(Number(lastInsertRowid)));
    },
    mine: async (userId) => (await q.mine.all(userId)).map(toItem),
    /** 회원 탈퇴: 검토 중인 제보(사진 파일 포함) 지우기 */
    async removePendingOf(userId) {
      const rows = await db.prepare("SELECT id, image_file FROM image_submissions WHERE user_id = ? AND status = 'pending'").all(userId);
      for (const r of rows) {
        await q.del.run(r.id);
        await images.remove(r.image_file);
      }
      changed(); // 승인된 제보의 제보자 이름(탈퇴하면 비움)을 다시 읽게
      return rows.length;
    },
    async cancel(userId, id) {
      const r = await q.byId.get(Number(id));
      if (!r || r.user_id !== userId) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      if (r.status !== 'pending') throw fail('NOT_PENDING', '검토가 끝난 제보는 취소할 수 없어요.', 409);
      await q.del.run(r.id);
      await images.remove(r.image_file);
      return { ok: true };
    },

    /** 관리자 */
    async list(status = 'pending') {
      if (!['pending', 'approved', 'rejected'].includes(status)) throw fail('BAD_REQUEST', '알 수 없는 상태예요.');
      const counts = { pending: 0, approved: 0, rejected: 0 };
      for (const c of await q.counts.all()) counts[c.status] = c.n;
      return { items: (await q.byStatus.all(status)).map(toItem), counts };
    },
    async approve(id, adminId) {
      const r = await q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      await q.setStatus.run('approved', null, iso(), adminId, r.id);
      changed();
      return toItem(await q.byId.get(r.id));
    },
    /** 거절 또는 승인 취소(사진 내리기) */
    async reject(id, adminId, reason) {
      const r = await q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      const why = typeof reason === 'string' ? reason.trim().replace(/\s+/g, ' ') : '';
      if (!why) throw fail('INVALID_SUBMISSION', '거절 사유를 입력해 주세요.');
      if (why.length > 200) throw fail('INVALID_SUBMISSION', '거절 사유는 200자 이내로 입력해 주세요.');
      await q.setStatus.run('rejected', why, iso(), adminId, r.id);
      changed();
      return toItem(await q.byId.get(r.id));
    },

    /** 사진 없는 게임에 승인된 사진 붙이기 */
    async applyAll(games) {
      const map = await approvedMap();
      if (!map.size) return games;
      return games.map((g) => {
        if (g.imageUrl) return g;
        const e = map.get(g.id);
        return e ? { ...g, imageUrl: e.imageUrl, imageSource: IMAGE_SUBMITTED, imageBy: e.by, imageSourceUrl: e.sourceUrl } : g;
      });
    },
    /** 사진 제보자 id (상세의 뱃지용) */
    submitterOf: async (gameId) => (await approvedMap()).get(gameId)?.byId ?? null,
  };
}
