// 제보 보상: 기여자 순위(영향력 점수) · 내 기여가 만든 변화 · 이정표 알림
//  - 점수는 저장하지 않고 승인된 제보와 그 게임의 찜·리뷰·조회로 그때그때 계산 (칭호와 같은 방식)
//  - 점수 = 승인 기본 점수(게임 3 · 사진 2 · 정보 1) + 반응 점수(승인 뒤 다른 회원의 찜 1 · 리뷰 2 · 조회 10회당 1)
//    반응은 내 몫 비율만큼(게임 제보 100% · 사진 50% · 정보 수정 25%), 게임 하나에서 한 달 최대 20점
//  - 저장하는 것: 날짜별 조회 수(game_views), 이정표 알림 보낸 기록(contrib_milestones)
import { avatarUrl } from './accounts.js';

export const BASE = { game: 3, photo: 2, fix: 1, ended: 1 };
export const SHARE = { game: 1, photo: 0.5, fix: 0.25, ended: 0 };
export const REACT = { wish: 1, review: 2, viewsPerPoint: 10 };
export const MONTH_CAP = 20;
const WISH_STEPS = [5, 10, 50, 100];
const VIEW_STEPS = [50, 100, 500, 1000];
const KIND_LABEL = { game: '내가 제보한', photo: '내가 표지를 넣은', fix: '내가 정보를 고친' };

const KST = 9 * 3600e3;
/** 한국 시간 날짜 'YYYY-MM-DD' */
export const kstDay = (t) => new Date(new Date(t).getTime() + KST).toISOString().slice(0, 10);
const kstMonth = (t) => kstDay(t).slice(0, 7);

/**
 * @param {object} opt
 * @param {Set<string>} opt.adminEmails  소문자 이메일
 * @param {(userId:number) => object|null} [opt.badgeOf]  대표 칭호
 * @param {(userId:number, note:object) => void} [opt.notify]  이정표 알림
 */
export function createContributors(db, { adminEmails = new Set(), badgeOf = () => null, notify = () => {}, now = () => Date.now() } = {}) {
  const q = {
    games: db.prepare(`SELECT id, user_id, title, reviewed_at FROM game_submissions WHERE status = 'approved' AND user_id IS NOT NULL`),
    photos: db.prepare(`SELECT user_id, game_id, game_title AS title, MIN(reviewed_at) AS reviewed_at FROM image_submissions
                        WHERE status = 'approved' AND user_id IS NOT NULL GROUP BY user_id, game_id`),
    reports: db.prepare(`SELECT user_id, kind, game_id, game_title AS title, MIN(reviewed_at) AS reviewed_at FROM game_reports
                         WHERE status = 'approved' AND user_id IS NOT NULL GROUP BY user_id, kind, game_id`),
    users: db.prepare('SELECT id, nickname, email, avatar_file FROM users'),
    view: db.prepare(`INSERT INTO game_views (game_id, day, views) VALUES (?, ?, 1)
                      ON CONFLICT(game_id, day) DO UPDATE SET views = views + 1`),
    milestone: db.prepare('INSERT OR IGNORE INTO contrib_milestones (user_id, game_id, kind, level, created_at) VALUES (?, ?, ?, ?, ?)'),
  };

  /** 승인된 기여 전체: [{ userId, gameId, kind, title, at }] (같은 회원·게임·종류는 한 번) */
  async function contributions() {
    const out = [];
    for (const r of await q.games.all()) out.push({ userId: r.user_id, gameId: `user-${r.id}`, kind: 'game', title: r.title, at: r.reviewed_at });
    for (const r of await q.photos.all()) out.push({ userId: r.user_id, gameId: r.game_id, kind: 'photo', title: r.title, at: r.reviewed_at });
    for (const r of await q.reports.all()) out.push({ userId: r.user_id, gameId: r.game_id, kind: r.kind, title: r.title, at: r.reviewed_at });
    return out.filter((c) => c.at);
  }

  async function adminIds() {
    const ids = new Set();
    for (const u of await q.users.all()) if (adminEmails.has(String(u.email).toLowerCase())) ids.add(u.id);
    return ids;
  }

  /** 게임들의 반응 기록: gameId → { wishes:[{userId,at}], reviews:[{userId,at}], views:[{day,views}] } */
  async function reactionsOf(gameIds) {
    const map = new Map(gameIds.map((id) => [id, { wishes: [], reviews: [], views: [] }]));
    if (!gameIds.length) return map;
    const marks = gameIds.map(() => '?').join(',');
    for (const r of await db.prepare(`SELECT user_id, game_id, created_at FROM wishlist WHERE game_id IN (${marks})`).all(...gameIds)) {
      map.get(r.game_id).wishes.push({ userId: r.user_id, at: r.created_at });
    }
    for (const r of await db.prepare(`SELECT user_id, game_id, created_at FROM reviews WHERE hidden_at IS NULL AND game_id IN (${marks})`).all(...gameIds)) {
      map.get(r.game_id).reviews.push({ userId: r.user_id, at: r.created_at });
    }
    for (const r of await db.prepare(`SELECT game_id, day, views FROM game_views WHERE game_id IN (${marks})`).all(...gameIds)) {
      map.get(r.game_id).views.push({ day: r.day, views: Number(r.views) });
    }
    return map;
  }

  /**
   * 기여 하나의 반응: 승인 뒤, 다른 회원(관리자 제외)의 반응만
   * @returns {{ wishes:number, reviews:number, views:number, byMonth: Map<string, number> }}  byMonth: 달별 반응 점수(내 몫·상한 적용 전)
   */
  function reactionOf(c, rx, admins) {
    const others = (x) => x.userId !== c.userId && !admins.has(x.userId) && x.at >= c.at;
    const startDay = kstDay(c.at);
    const wishes = rx.wishes.filter(others);
    const reviews = rx.reviews.filter(others);
    const views = rx.views.filter((v) => v.day >= startDay);
    const byMonth = new Map();
    const add = (m, n) => byMonth.set(m, (byMonth.get(m) ?? 0) + n);
    for (const w of wishes) add(kstMonth(w.at), REACT.wish);
    for (const r of reviews) add(kstMonth(r.at), REACT.review);
    const viewMonths = new Map();
    for (const v of views) viewMonths.set(v.day.slice(0, 7), (viewMonths.get(v.day.slice(0, 7)) ?? 0) + v.views);
    for (const [m, n] of viewMonths) add(m, Math.floor(n / REACT.viewsPerPoint));
    return { wishes: wishes.length, reviews: reviews.length, views: views.reduce((s, v) => s + v.views, 0), byMonth };
  }

  /** 회원별 점수: period 'month'(이번 달, 한국 시간) | 'all' */
  async function scores(period) {
    const month = kstMonth(now());
    const admins = await adminIds();
    const list = (await contributions()).filter((c) => !admins.has(c.userId));
    const rx = await reactionsOf([...new Set(list.filter((c) => SHARE[c.kind] > 0).map((c) => c.gameId))]);
    const per = new Map();
    // 같은 회원이 같은 게임에 여러 종류로 기여하면 반응은 가장 큰 몫 하나로만
    const bestShare = new Map();
    for (const c of list) {
      const s = per.get(c.userId) ?? { userId: c.userId, base: 0, reaction: 0, games: 0, photos: 0, infos: 0, approvals: 0, lastAt: '' };
      per.set(c.userId, s);
      const inPeriod = period === 'all' || kstMonth(c.at) === month;
      if (inPeriod) {
        s.base += BASE[c.kind];
        s.approvals += 1;
        if (c.kind === 'game') s.games += 1;
        else if (c.kind === 'photo') s.photos += 1;
        else s.infos += 1;
        if (c.at > s.lastAt) s.lastAt = c.at;
      }
      const key = `${c.userId}|${c.gameId}`;
      if (SHARE[c.kind] > (bestShare.get(key)?.share ?? 0)) bestShare.set(key, { c, share: SHARE[c.kind] });
    }
    for (const { c, share } of bestShare.values()) {
      const { byMonth } = reactionOf(c, rx.get(c.gameId), admins);
      let pts = 0;
      for (const [m, n] of byMonth) if (period === 'all' || m === month) pts += Math.min(MONTH_CAP, n * share);
      per.get(c.userId).reaction += pts;
    }
    const users = new Map((await q.users.all()).map((u) => [u.id, u]));
    return [...per.values()]
      .map((s) => ({ ...s, reaction: Math.floor(s.reaction), score: s.base + Math.floor(s.reaction) }))
      .filter((s) => s.score > 0 && users.has(s.userId))
      .sort((a, b) => b.score - a.score || b.approvals - a.approvals || (a.lastAt < b.lastAt ? -1 : a.lastAt > b.lastAt ? 1 : 0) || a.userId - b.userId)
      .map((s, i) => ({ ...s, rank: i + 1, user: users.get(s.userId) }));
  }

  const out = async (s) => ({
    rank: s.rank,
    nickname: s.user.nickname,
    avatarUrl: avatarUrl(s.user.avatar_file),
    badge: await badgeOf(s.userId),
    score: s.score,
    base: s.base,
    reaction: s.reaction,
    games: s.games,
    photos: s.photos,
    infos: s.infos,
  });

  /** 이 게임의 기여자(관리자 제외): [{ userId, kind, title }] — 한 회원은 가장 큰 기여 하나로 */
  async function contributorsOf(gameId) {
    const admins = await adminIds();
    const by = new Map();
    for (const c of await contributions()) {
      if (c.gameId !== gameId || admins.has(c.userId) || !SHARE[c.kind]) continue;
      if (SHARE[c.kind] > (by.get(c.userId) ? SHARE[by.get(c.userId).kind] : 0)) by.set(c.userId, c);
    }
    return [...by.values()];
  }

  /** 이정표를 처음 넘었을 때만 알림 */
  async function milestone(c, kind, level, note) {
    const r = await q.milestone.run(c.userId, c.gameId, kind, level, new Date(now()).toISOString());
    if (Number(r.changes) > 0) await notify(c.userId, { kind: 'impact', tone: 'badge', link: `/games/${encodeURIComponent(c.gameId)}`, ...note });
  }
  const quote = (t) => `‘${t}’`;

  // 같은 사람이 같은 게임을 하루에 여러 번 열어도 한 번만 셈
  let seenDay = '';
  let seen = new Set();

  return {
    async leaderboard({ period = 'month', limit = 20 } = {}) {
      if (!['month', 'all'].includes(period)) period = 'month';
      return { period, month: kstMonth(now()), items: await Promise.all((await scores(period)).slice(0, limit).map(out)) };
    },
    /** 내 이번 달·전체 순위 (점수가 없으면 rank null) */
    async mine(userId) {
      const pick = async (period) => {
        const s = (await scores(period)).find((x) => x.userId === userId);
        return s ? { rank: s.rank, score: s.score, base: s.base, reaction: s.reaction } : { rank: null, score: 0, base: 0, reaction: 0 };
      };
      return { month: await pick('month'), all: await pick('all') };
    },

    /** 내 기여가 만든 변화: 기여한 게임마다 다른 회원의 조회·찜·리뷰 (서비스 종료 제보 제외) */
    async impact(userId) {
      const admins = await adminIds();
      const mine = new Map();
      for (const c of await contributions()) {
        if (c.userId !== userId || !SHARE[c.kind]) continue;
        const prev = mine.get(c.gameId);
        if (!prev || SHARE[c.kind] > SHARE[prev.kind]) mine.set(c.gameId, c);
      }
      const rx = await reactionsOf([...mine.keys()]);
      const items = [...mine.values()].map((c) => {
        const r = reactionOf(c, rx.get(c.gameId), admins);
        return { gameId: c.gameId, title: c.title, kind: c.kind, approvedAt: c.at, views: r.views, wishes: r.wishes, reviews: r.reviews };
      });
      items.sort((a, b) => b.wishes + b.reviews * 2 - (a.wishes + a.reviews * 2) || b.views - a.views);
      const sum = (k) => items.reduce((s, x) => s + x[k], 0);
      return { games: items.length, views: sum('views'), wishes: sum('wishes'), reviews: sum('reviews'), items };
    },

    /** 게임 상세를 열 때: 조회 수 +1 (하루 한 번, 기여자 본인·관리자 제외) → 조회 이정표 */
    async recordView(gameId, viewerKey, viewerUserId = null, viewerIsAdmin = false) {
      const day = kstDay(now());
      if (day !== seenDay) {
        seenDay = day;
        seen = new Set();
      }
      const key = `${viewerKey}|${gameId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      if (viewerIsAdmin) return false;
      const contributors = await contributorsOf(gameId);
      if (!contributors.length || contributors.some((c) => c.userId === viewerUserId)) return false;
      await q.view.run(gameId, day);
      const admins = await adminIds();
      const rx = (await reactionsOf([gameId])).get(gameId);
      for (const c of contributors) {
        const n = reactionOf(c, rx, admins).views;
        for (const step of VIEW_STEPS) {
          if (n >= step) await milestone(c, 'views', step, { title: `${KIND_LABEL[c.kind]} ${quote(c.title)}이(가) 조회 ${step}회를 넘었어요 👀`, body: '회원들이 내 기여 덕분에 이 게임을 찾고 있어요.' });
        }
      }
      return true;
    },

    /** 찜·리뷰가 생긴 뒤: 그 게임 기여자에게 이정표 알림 */
    async afterReaction(gameId) {
      const contributors = await contributorsOf(gameId);
      if (!contributors.length) return;
      const admins = await adminIds();
      const rx = (await reactionsOf([gameId])).get(gameId);
      for (const c of contributors) {
        const r = reactionOf(c, rx, admins);
        for (const step of WISH_STEPS) {
          if (r.wishes >= step) await milestone(c, 'wishes', step, { title: `${KIND_LABEL[c.kind]} ${quote(c.title)}을(를) 회원 ${step}명이 찜했어요 🎉`, body: '내 기여 덕분에 친구와 할 게임을 찾은 회원들이에요.' });
        }
        if (r.reviews >= 1) await milestone(c, 'review', 1, { title: `${KIND_LABEL[c.kind]} ${quote(c.title)}에 첫 리뷰가 달렸어요 💬`, body: '다른 회원이 이 게임을 해 보고 리뷰를 남겼어요.' });
      }
    },
  };
}
