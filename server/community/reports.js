// 회원 제보·신고
//  1) 서비스 종료 제보(kind=ended): 근거 주소와 함께 → 관리자 승인 → 목록·검색에서 숨김(상세는 열림, 종료 안내)
//  2) 정보 수정 제보(kind=fix): 추천 인원·플레이 시간·구매처 등 → 관리자 승인 → 게임 정보에 반영('사용자 제보' 표시)
//  3) 리뷰 신고: 욕설·광고·스포일러 등 → 관리자가 확인해 숨기거나 문제 없음 처리
//  - 로그인한 회원만. 관리자가 직접 올린 서비스 종료·정보 수정 제보는 바로 승인
import { DataSourceError } from '../providers/errors.js';
import { storeFromUrl } from '../providers/igdbProvider.js';
import { validateSourceUrl } from './imageSubmissions.js';
import { cached } from './cached.js';

const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
export const MAX_PENDING_REPORTS = 20;
export const REVIEW_REASONS = {
  abuse: '욕설·비방',
  spam: '광고·도배',
  spoiler: '스포일러',
  offtopic: '게임과 관련 없음',
  other: '기타',
};

const clean = (v, max, label) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length > max) throw fail('INVALID_REPORT', `${label}은(는) ${max}자 이내로 입력해 주세요.`);
  return s || null;
};
const has = (v) => v != null && v !== '';

/** 정보 수정 제보 값 검증 → { players?, hours?, storeUrl? } (하나 이상 또는 메모 필요) */
export function validateFix(input) {
  const b = input && typeof input === 'object' ? input : {};
  const out = {};
  if (has(b.playersMin) || has(b.playersMax)) {
    const min = Number(b.playersMin);
    const max = Number(b.playersMax);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 100 || min > max) {
      throw fail('INVALID_REPORT', '추천 인원은 1~100 사이로, 최소가 최대보다 크지 않게 입력해 주세요.');
    }
    out.players = { min, max };
  }
  if (has(b.hours)) {
    const h = Number(b.hours);
    if (!Number.isInteger(h) || h < 1 || h > 1000) throw fail('INVALID_REPORT', '플레이 시간은 1~1000 사이의 시간(정수)으로 입력해 주세요.');
    out.hours = h;
  }
  if (has(b.storeUrl)) {
    const s = storeFromUrl(String(b.storeUrl).trim());
    if (!s) throw fail('INVALID_REPORT', '구매처는 Steam·App Store·Google Play·닌텐도·PlayStation·Xbox·Epic 등 공식 스토어 주소만 넣을 수 있어요.');
    out.storeUrl = s.url;
  }
  return out;
}

/** 정보 수정 값 → 화면 문구, 바뀐 칸 */
const FIX_FIELDS = [
  ['players', '추천 인원', (f) => (f.players ? `${f.players.min}~${f.players.max}명` : null)],
  ['hours', '플레이 시간', (f) => (f.hours ? `${f.hours}시간` : null)],
  ['storeUrl', '구매처', (f) => f.storeUrl ?? null],
];
export function diffFix(a, b) {
  return FIX_FIELDS.flatMap(([field, label, show]) => {
    const from = show(a) ?? '(없음)';
    const to = show(b) ?? '(반영 안 함)';
    return show(a) === show(b) ? [] : [{ field, label, from, to }];
  });
}

export function createReports(db, { now = () => Date.now() } = {}) {
  const q = {
    insert: db.prepare(`INSERT INTO game_reports (user_id, kind, game_id, game_title, payload, source_url, note, status, created_at, reviewed_at, reviewed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT g.*, u.nickname FROM game_reports g LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?'),
    mine: db.prepare('SELECT * FROM game_reports WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100'),
    pendingCount: db.prepare(`SELECT COUNT(*) AS n FROM game_reports WHERE user_id = ? AND status = 'pending'`),
    samePending: db.prepare(`SELECT id FROM game_reports WHERE user_id = ? AND game_id = ? AND kind = ? AND status = 'pending'`),
    byStatus: db.prepare('SELECT g.*, u.nickname FROM game_reports g LEFT JOIN users u ON u.id = g.user_id WHERE g.kind = ? AND g.status = ? ORDER BY g.created_at DESC, g.id DESC LIMIT 200'),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM game_reports WHERE kind = ? GROUP BY status'),
    approved: db.prepare(`SELECT g.*, u.nickname FROM game_reports g LEFT JOIN users u ON u.id = g.user_id WHERE g.status = 'approved' ORDER BY g.reviewed_at, g.id`),
    setStatus: db.prepare('UPDATE game_reports SET status = ?, reject_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'),
    setPayload: db.prepare('UPDATE game_reports SET payload = ? WHERE id = ?'),
    setOriginal: db.prepare('UPDATE game_reports SET original_payload = ? WHERE id = ? AND original_payload IS NULL'),
    del: db.prepare('DELETE FROM game_reports WHERE id = ?'),

    review: db.prepare('SELECT id, user_id, hidden_at FROM reviews WHERE id = ?'),
    rrInsert: db.prepare('INSERT INTO review_reports (review_id, reporter_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?)'),
    rrMine: db.prepare('SELECT review_id FROM review_reports WHERE reporter_id = ? AND review_id IN (SELECT id FROM reviews WHERE game_id = ?)'),
    rrSame: db.prepare('SELECT id FROM review_reports WHERE review_id = ? AND reporter_id = ?'),
    // 상태별 신고된 리뷰 목록 (리뷰 하나에 신고 여러 개)
    rrReviews: db.prepare(`SELECT DISTINCT r.id, r.game_id, r.game_title, r.rating, r.content, r.created_at, r.hidden_at, u.nickname
      FROM review_reports rr JOIN reviews r ON r.id = rr.review_id LEFT JOIN users u ON u.id = r.user_id
      WHERE rr.status = ? ORDER BY r.id DESC LIMIT 200`),
    rrOf: db.prepare(`SELECT rr.reason, rr.note, rr.status, rr.created_at, u.nickname FROM review_reports rr LEFT JOIN users u ON u.id = rr.reporter_id
      WHERE rr.review_id = ? ORDER BY rr.created_at`),
    rrCounts: db.prepare('SELECT status, COUNT(DISTINCT review_id) AS n FROM review_reports GROUP BY status'),
    rrSet: db.prepare('UPDATE review_reports SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE review_id = ? AND status = ?'),
    hide: db.prepare('UPDATE reviews SET hidden_at = ? WHERE id = ?'),
  };
  const iso = () => new Date(now()).toISOString();
  const changed = () => overrides.clear();

  const toItem = (r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    gameId: r.game_id,
    gameTitle: r.game_title,
    fix: JSON.parse(r.payload || '{}'),
    sourceUrl: r.source_url,
    note: r.note,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    submitter: r.nickname ?? null,
    // 관리자가 고친 칸 (회원이 낸 값 → 반영된 값)
    edited: r.original_payload ? diffFix(JSON.parse(r.original_payload), JSON.parse(r.payload || '{}')) : [],
  });

  /**
   * 정보 수정 제보를 관리자가 고친 값으로 (비운 칸은 반영하지 않음). 바뀐 칸 목록을 돌려줌
   * edits: { playersMin, playersMax, hours, storeUrl } — 화면은 남길 칸을 모두 보냄
   */
  async function applyEdits(r, edits) {
    if (!edits || typeof edits !== 'object') return [];
    if (r.kind !== 'fix') throw fail('BAD_REQUEST', '서비스 종료 제보는 고칠 내용이 없어요. 승인 또는 거절만 할 수 있어요.');
    const cur = JSON.parse(r.payload || '{}');
    const next = validateFix(edits);
    if (!Object.keys(next).length) throw fail('INVALID_REPORT', '반영할 내용이 하나도 없어요. 거절해 주세요.');
    const diff = diffFix(cur, next);
    if (!diff.length) return [];
    await q.setOriginal.run(r.payload || '{}', r.id);
    await q.setPayload.run(JSON.stringify(next), r.id);
    return diff;
  }

  /** 승인된 제보 → 게임별 반영 값 (같은 항목은 나중에 승인된 것이 우선) */
  const overrides = cached(async () => {
    const cache = new Map(); // game_id → 반영할 값
    for (const r of await q.approved.all()) {
      const o = cache.get(r.game_id) ?? {};
      if (r.kind === 'ended') Object.assign(o, { ended: true, endedBy: r.nickname ?? null, endedSourceUrl: r.source_url });
      else {
        const f = JSON.parse(r.payload || '{}');
        if (f.players) o.players = f.players;
        if (f.hours) o.hours = f.hours;
        if (f.storeUrl) o.storeUrls = [...new Set([...(o.storeUrls ?? []), f.storeUrl])];
        o.fixedBy = r.nickname ?? null;
      }
      cache.set(r.game_id, o);
    }
    return cache;
  }, { now });

  /** 게임에 승인된 제보 반영 (map: overrides()) */
  function apply(map, g) {
    const o = map.get(g.id);
    if (!o) return g;
    let out = g;
    if (o.ended) out = { ...out, userEnded: true, endedSourceUrl: o.endedSourceUrl };
    if (o.players) out = { ...out, recommendedPlayers: { ...o.players, source: 'user' } };
    if (o.hours) out = { ...out, userPlaytime: o.hours };
    if (o.storeUrls) {
      const stores = [...(out.stores || [])];
      for (const url of o.storeUrls) {
        const s = storeFromUrl(url);
        if (s && !stores.some((x) => x.url === s.url)) stores.push({ ...s, userReported: true });
      }
      out = { ...out, stores };
    }
    if (o.fixedBy !== undefined) out = { ...out, fixedByUser: true };
    return out;
  }

  return {
    // ── 서비스 종료·정보 수정 제보 ──
    /** game: 서버가 다시 조회한 게임 */
    async createGameReport(user, game, input) {
      if (!game || game.isDemo) throw fail('NOT_FOUND', '게임을 찾을 수 없어요.', 404);
      const kind = input?.kind;
      if (kind !== 'ended' && kind !== 'fix') throw fail('INVALID_REPORT', '알 수 없는 제보 종류예요.');
      const note = clean(input?.note, 500, '설명');
      let payload = {};
      let sourceUrl = null;
      if (kind === 'ended') {
        if (game.userEnded) throw fail('ALREADY', '이미 서비스 종료로 확인된 게임이에요.', 409);
        sourceUrl = validateSourceUrl(input?.sourceUrl); // 종료 공지 등 근거 필수
      } else {
        payload = validateFix(input);
        if (!Object.keys(payload).length && !note) throw fail('INVALID_REPORT', '고칠 내용(추천 인원·플레이 시간·구매처)이나 설명을 하나 이상 입력해 주세요.');
        if (has(input?.sourceUrl)) sourceUrl = validateSourceUrl(input.sourceUrl);
      }
      if (!user.isAdmin) {
        if ((await q.pendingCount.get(user.id)).n >= MAX_PENDING_REPORTS) throw fail('TOO_MANY', `검토 중인 제보가 ${MAX_PENDING_REPORTS}개 있어요. 결과가 나온 뒤 다시 제보해 주세요.`, 429);
        if (await q.samePending.get(user.id, game.id, kind)) throw fail('DUPLICATE', '이 게임에 같은 종류의 검토 중인 제보가 이미 있어요.', 409);
      }
      const at = iso();
      const status = user.isAdmin ? 'approved' : 'pending';
      const { lastInsertRowid } = await q.insert.run(
        user.id, kind, game.id, String(game.title).slice(0, 120), JSON.stringify(payload), sourceUrl, note, status, at, user.isAdmin ? at : null, user.isAdmin ? user.id : null,
      );
      if (user.isAdmin) changed();
      return toItem(await q.byId.get(Number(lastInsertRowid)));
    },
    mineGameReports: async (userId) => (await q.mine.all(userId)).map(toItem),
/** 회원 탈퇴: 검토 중인 제보(기록) 지우기 */
    async removePendingOf(userId) {
      const rows = await db.prepare("SELECT id FROM game_reports WHERE user_id = ? AND status = 'pending'").all(userId);
      for (const r of rows) {
        await q.del.run(r.id);
      }
      changed(); // 승인된 제보의 제보자 이름(탈퇴하면 비움)을 다시 읽게
      return rows.length;
    },
    async cancelGameReport(userId, id) {
      const r = await q.byId.get(Number(id));
      if (!r || r.user_id !== userId) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      if (r.status !== 'pending') throw fail('NOT_PENDING', '검토가 끝난 제보는 취소할 수 없어요.', 409);
      await q.del.run(r.id);
      return { ok: true };
    },
    async listGameReports(kind, status = 'pending') {
      if (!['ended', 'fix'].includes(kind)) throw fail('BAD_REQUEST', '알 수 없는 제보 종류예요.');
      if (!['pending', 'approved', 'rejected'].includes(status)) throw fail('BAD_REQUEST', '알 수 없는 상태예요.');
      const counts = { pending: 0, approved: 0, rejected: 0 };
      for (const c of await q.counts.all(kind)) counts[c.status] = c.n;
      return { items: (await q.byStatus.all(kind, status)).map(toItem), counts };
    },
    /** 승인 (edits: 관리자가 고친 정보 수정 값). changes: 이번에 고친 칸 */
    async approveGameReport(id, adminId, edits) {
      const r = await q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      const changes = await applyEdits(r, edits);
      await q.setStatus.run('approved', null, iso(), adminId, r.id);
      changed();
      return { ...toItem(await q.byId.get(r.id)), changes };
    },
    /** 이미 승인된 정보 수정 제보 고치기 (알림 없음) */
    async editGameReport(id, edits) {
      const r = await q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      if (r.status !== 'approved') throw fail('NOT_APPROVED', '승인된 제보만 고칠 수 있어요. 검토 중이면 ‘고쳐서 승인’을 써 주세요.', 409);
      const changes = await applyEdits(r, edits);
      if (!changes.length) throw fail('NO_CHANGE', '바뀐 내용이 없어요.');
      changed();
      return { ...toItem(await q.byId.get(r.id)), changes };
    },
    /** 거절 또는 승인 취소(반영 되돌리기) */
    async rejectGameReport(id, adminId, reason) {
      const r = await q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      const why = clean(reason, 200, '거절 사유');
      if (!why) throw fail('INVALID_REPORT', '거절 사유를 입력해 주세요.');
      await q.setStatus.run('rejected', why, iso(), adminId, r.id);
      changed();
      return toItem(await q.byId.get(r.id));
    },
    async applyAll(games) {
      const map = await overrides();
      return map.size ? games.map((g) => apply(map, g)) : games;
    },

    // ── 리뷰 신고 ──
    async reportReview(userId, reviewId, input) {
      const r = await q.review.get(Number(reviewId));
      if (!r || r.hidden_at) throw fail('NOT_FOUND', '리뷰를 찾을 수 없어요.', 404);
      if (r.user_id === userId) throw fail('OWN_REVIEW', '내 리뷰는 신고할 수 없어요.');
      const reason = input?.reason;
      if (!REVIEW_REASONS[reason]) throw fail('INVALID_REPORT', '신고 사유를 골라 주세요.');
      const note = clean(input?.note, 300, '설명');
      if (await q.rrSame.get(r.id, userId)) throw fail('DUPLICATE', '이미 신고한 리뷰예요.', 409);
      await q.rrInsert.run(r.id, userId, reason, note, iso());
      return { ok: true };
    },
    /** 이 게임에서 내가 신고한 리뷰 id */
    reportedIds: async (userId, gameId) => new Set((await q.rrMine.all(userId, gameId)).map((x) => x.review_id)),
    async listReviewReports(status = 'pending') {
      if (!['pending', 'upheld', 'dismissed'].includes(status)) throw fail('BAD_REQUEST', '알 수 없는 상태예요.');
      const counts = { pending: 0, upheld: 0, dismissed: 0 };
      for (const c of await q.rrCounts.all()) counts[c.status] = c.n;
      const items = await Promise.all((await q.rrReviews.all(status)).map(async (r) => {
        const reports = (await q.rrOf.all(r.id)).map((x) => ({ reason: x.reason, reasonText: REVIEW_REASONS[x.reason] ?? x.reason, note: x.note, status: x.status, reporter: x.nickname ?? null, createdAt: x.created_at }));
        return {
          reviewId: r.id,
          gameId: r.game_id,
          gameTitle: r.game_title || r.game_id,
          rating: r.rating,
          content: r.content,
          author: r.nickname ?? '(탈퇴한 회원)',
          createdAt: r.created_at,
          hidden: Boolean(r.hidden_at),
          reports,
          count: reports.length,
        };
      }));
      return { items, counts };
    },
    /** hide: 숨김(신고 인정) · dismiss: 문제 없음 · restore: 숨긴 리뷰 다시 보이기 */
    async resolveReview(reviewId, adminId, action) {
      const r = await q.review.get(Number(reviewId));
      if (!r) throw fail('NOT_FOUND', '리뷰를 찾을 수 없어요.', 404);
      const at = iso();
      if (action === 'hide') {
        await q.hide.run(at, r.id);
        await q.rrSet.run('upheld', at, adminId, r.id, 'pending');
      } else if (action === 'dismiss') {
        await q.rrSet.run('dismissed', at, adminId, r.id, 'pending');
      } else if (action === 'restore') {
        await q.hide.run(null, r.id);
        await q.rrSet.run('dismissed', at, adminId, r.id, 'upheld');
      } else throw fail('BAD_REQUEST', '알 수 없는 처리예요.');
      return { ok: true };
    },
  };
}
