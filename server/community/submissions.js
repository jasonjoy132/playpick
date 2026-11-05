// 회원 게임 제보 → 관리자 승인 → 게임으로 추가
//  - 로그인한 회원만 제보. 한 사람이 동시에 '검토 중'으로 둘 수 있는 제보는 10개까지.
//  - 관리자(.env 의 ADMIN_EMAILS)가 승인하면 id 'user-<번호>' 게임이 되어 검색·나만의 게임 찾기·상세에 나옵니다.
//  - 거절할 때는 사유를 남기고, 제보한 회원은 마이페이지 '내 제보'에서 상태·사유를 봅니다.
//  - 구매처 링크는 공식 스토어 주소만 받습니다(엉뚱한·위험한 링크 방지). 표지는 이미지 검사 후 저장.
import { DataSourceError } from '../providers/errors.js';
import { storeFromUrl, normTitle } from '../providers/igdbProvider.js';
import { PLATFORMS, GENRES } from '../services/taxonomy.js';

const fail = (code, message, status = 400) => new DataSourceError(code, message, status);
const PLATFORM_VALUES = new Set(PLATFORMS.filter((p) => !p.hidden).map((p) => p.value)); // 아케이드는 제보 불가
const GENRE_VALUES = new Set(GENRES.map((g) => g.value));
export const MAX_PENDING = 10;
export const SUBMITTED = '사용자 제보';
export const imageUrlOf = (file) => (file ? `/submission-images/${file}` : null);

const text = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!s) {
    if (required) throw fail('INVALID_SUBMISSION', `${label}을(를) 입력해 주세요.`);
    return null;
  }
  if (s.length > max) throw fail('INVALID_SUBMISSION', `${label}은(는) ${max}자 이내로 입력해 주세요.`);
  return s;
};
const longText = (v, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw fail('INVALID_SUBMISSION', `${label}은(는) ${max}자 이내로 입력해 주세요.`);
  return s || null;
};

/** 제보 입력 검증 → 저장할 값 */
export function validateSubmission(input, { now = () => Date.now() } = {}) {
  const b = input && typeof input === 'object' ? input : {};
  const title = text(b.title, 80, '게임 이름', true);
  const originalTitle = text(b.originalTitle, 80, '영문(원제) 이름');
  const publisher = text(b.publisher, 60, '개발·유통사');
  const summary = longText(b.summary, 1000, '소개');

  const list = (v, allowed, label) => {
    const arr = [...new Set(Array.isArray(v) ? v : [])];
    if (!arr.length) throw fail('INVALID_SUBMISSION', `${label}을(를) 하나 이상 골라 주세요.`);
    if (arr.some((x) => !allowed.has(x))) throw fail('INVALID_SUBMISSION', `알 수 없는 ${label}이(가) 있어요.`);
    return arr;
  };
  const platforms = list(b.platforms, PLATFORM_VALUES, '플랫폼');
  const genres = list(b.genres, GENRE_VALUES, '장르');

  let playersMin = null;
  let playersMax = null;
  const has = (v) => v != null && v !== '';
  if (has(b.playersMin) || has(b.playersMax)) {
    playersMin = Number(b.playersMin);
    playersMax = Number(b.playersMax);
    if (!Number.isInteger(playersMin) || !Number.isInteger(playersMax) || playersMin < 1 || playersMax > 100 || playersMin > playersMax) {
      throw fail('INVALID_SUBMISSION', '추천 인원은 1~100 사이로, 최소가 최대보다 크지 않게 입력해 주세요.');
    }
  }

  let releaseYear = null;
  if (has(b.releaseYear)) {
    releaseYear = Number(b.releaseYear);
    const maxYear = new Date(now()).getFullYear() + 3;
    if (!Number.isInteger(releaseYear) || releaseYear < 1970 || releaseYear > maxYear) throw fail('INVALID_SUBMISSION', `출시 연도는 1970~${maxYear} 사이로 입력해 주세요.`);
  }

  let storeUrl = null;
  if (has(b.storeUrl)) {
    const s = storeFromUrl(String(b.storeUrl).trim());
    if (!s) throw fail('INVALID_SUBMISSION', '구매처는 Steam·App Store·Google Play·닌텐도·PlayStation·Xbox·Epic 등 공식 스토어 주소만 넣을 수 있어요.');
    storeUrl = s.url;
  }
  return { title, originalTitle, publisher, summary, platforms, genres, playersMin, playersMax, releaseYear, storeUrl };
}

export function createSubmissions(db, { images, now = () => Date.now() }) {
  const q = {
    insert: db.prepare(`INSERT INTO game_submissions
      (user_id, title, original_title, publisher, release_year, platforms, genres, players_min, players_max, store_url, summary, image_file, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare(`SELECT s.*, u.nickname FROM game_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`),
    mine: db.prepare('SELECT * FROM game_submissions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100'),
    pendingCount: db.prepare(`SELECT COUNT(*) AS n FROM game_submissions WHERE user_id = ? AND status = 'pending'`),
    sameTitle: db.prepare(`SELECT id, status FROM game_submissions WHERE user_id = ? AND title = ? AND status != 'rejected'`),
    byStatus: db.prepare(`SELECT s.*, u.nickname FROM game_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 200`),
    counts: db.prepare('SELECT status, COUNT(*) AS n FROM game_submissions GROUP BY status'),
    approved: db.prepare(`SELECT s.*, u.nickname FROM game_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'approved'`),
    setStatus: db.prepare('UPDATE game_submissions SET status = ?, reject_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'),
    del: db.prepare('DELETE FROM game_submissions WHERE id = ?'),
  };
  let approvedCache = null;
  const iso = () => new Date(now()).toISOString();

  /** DB 행 → 화면용 제보 */
  const toItem = (r) => ({
    id: r.id,
    status: r.status,
    title: r.title,
    originalTitle: r.original_title,
    publisher: r.publisher,
    releaseYear: r.release_year,
    platforms: JSON.parse(r.platforms),
    genres: JSON.parse(r.genres),
    playersMin: r.players_min,
    playersMax: r.players_max,
    storeUrl: r.store_url,
    summary: r.summary,
    imageUrl: imageUrlOf(r.image_file),
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    submitter: r.nickname ?? null,
    gameId: r.status === 'approved' ? `user-${r.id}` : null,
  });

  /** 승인된 제보 → 플레이픽 게임 모델 */
  const toGame = (r) => {
    const players = r.players_min != null ? { min: r.players_min, max: r.players_max } : null;
    const store = r.store_url ? storeFromUrl(r.store_url) : null;
    return {
      id: `user-${r.id}`,
      title: r.title,
      originalTitle: r.original_title,
      isDemo: false,
      source: SUBMITTED,
      submittedBy: r.nickname ?? null,
      submittedById: r.user_id ?? null, // 서버 안에서만(뱃지 계산), 응답 전에 지움
      publisher: r.publisher,
      summary: r.summary,
      platforms: JSON.parse(r.platforms),
      platformsRaw: null,
      genres: JSON.parse(r.genres),
      genresRaw: null,
      players,
      ...(players ? { recommendedPlayers: { ...players, source: 'user' } } : {}),
      rating: null,
      ratingSource: null,
      domesticRating: false,
      ratingDate: null,
      ratingNo: null,
      contentDescriptors: null,
      releaseDate: r.release_year ? String(r.release_year) : null,
      imageUrl: imageUrlOf(r.image_file),
      bannerUrl: null,
      globalRating: null,
      stores: store ? [store] : [],
      approvedAt: r.reviewed_at,
    };
  };

  function approvedGames() {
    approvedCache ??= q.approved.all().map(toGame);
    return approvedCache;
  }
  const changed = () => {
    approvedCache = null;
  };

  return {
    /** 회원 제보 */
    create(userId, input) {
      const v = validateSubmission(input, { now });
      if (q.pendingCount.get(userId).n >= MAX_PENDING) throw fail('TOO_MANY', `검토 중인 제보가 ${MAX_PENDING}개 있어요. 결과가 나온 뒤 다시 제보해 주세요.`, 429);
      if (q.sameTitle.get(userId, v.title)) throw fail('DUPLICATE', '같은 이름으로 이미 제보한 게임이 있어요. 마이페이지 ‘내 제보’에서 확인해 주세요.', 409);
      const imageFile = input?.image ? images.save(userId, input.image) : null;
      const { lastInsertRowid } = q.insert.run(
        userId, v.title, v.originalTitle, v.publisher, v.releaseYear, JSON.stringify(v.platforms), JSON.stringify(v.genres),
        v.playersMin, v.playersMax, v.storeUrl, v.summary, imageFile, iso(),
      );
      return toItem(q.byId.get(Number(lastInsertRowid)));
    },
    mine: (userId) => q.mine.all(userId).map(toItem),
    /** 검토 중인 내 제보 취소 */
    cancel(userId, id) {
      const r = q.byId.get(Number(id));
      if (!r || r.user_id !== userId) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      if (r.status !== 'pending') throw fail('NOT_PENDING', '검토가 끝난 제보는 취소할 수 없어요.', 409);
      q.del.run(r.id);
      images.remove(r.image_file);
      return { ok: true };
    },

    /** 관리자 */
    list(status = 'pending') {
      if (!['pending', 'approved', 'rejected'].includes(status)) throw fail('BAD_REQUEST', '알 수 없는 상태예요.');
      const counts = Object.fromEntries(['pending', 'approved', 'rejected'].map((s) => [s, 0]));
      for (const c of q.counts.all()) counts[c.status] = c.n;
      return { items: q.byStatus.all(status).map(toItem), counts };
    },
    approve(id, adminId) {
      const r = q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      q.setStatus.run('approved', null, iso(), adminId, r.id);
      changed();
      return toItem(q.byId.get(r.id));
    },
    /** 거절(검토 중) 또는 승인 취소(이미 추가된 게임 내리기) */
    reject(id, adminId, reason) {
      const r = q.byId.get(Number(id));
      if (!r) throw fail('NOT_FOUND', '제보를 찾을 수 없어요.', 404);
      const why = text(reason, 200, '거절 사유', true);
      q.setStatus.run('rejected', why, iso(), adminId, r.id);
      changed();
      return toItem(q.byId.get(r.id));
    },

    /** 승인된 게임 */
    approvedGames,
    getGame(id) {
      const m = /^user-(\d{1,9})$/.exec(String(id));
      return m ? (approvedGames().find((g) => g.id === `user-${m[1]}`) ?? null) : null;
    },
    /** 이름(한글·원제, 공백·기호 무시)에 검색어가 들어간 승인 게임 */
    search(query) {
      const n = normTitle(query);
      if (!n) return [];
      return approvedGames().filter((g) => [g.title, g.originalTitle].some((t) => t && normTitle(t).includes(n)));
    },
  };
}
