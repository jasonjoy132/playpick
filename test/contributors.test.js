// 기여자 순위(영향력 점수) · 내 기여 요약 · 조회 수 · 이정표 알림
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createContributors, MONTH_CAP } from '../server/community/contributors.js';

const GAMES = {
  'igdb-81': { id: 'igdb-81', title: '정보 고친 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: 'https://x/y.jpg', altNames: [] },
  'igdb-82': { id: 'igdb-82', title: '사진 넣은 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: null, altNames: [] },
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  getMany: async (ids) => ids.map((id) => GAMES[id]).filter(Boolean),
  browse: async () => ({ games: Object.values(GAMES), hasMore: false }),
  search: async () => ({ games: Object.values(GAMES), warnings: [] }),
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server, base;
before(async () => {
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['Boss@example.com'] },
    { catalog, partySize, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
}
const signup = (c, id) => c('POST', '/api/auth/signup', { loginId: id, password: 'secret123', nickname: `${id}닉`, email: `${id}@example.com` });

test('영향력 점수: 기본 점수 + 다른 회원 반응(내 몫 비율), 관리자·본인 반응 제외, 순위·내 기여 요약', async () => {
  const admin = client();
  await admin('POST', '/api/auth/signup', { loginId: 'boss', password: 'secret123', nickname: '보스', email: 'boss@example.com' });
  const [alice, bob, carol, dave] = [client(), client(), client(), client()];
  for (const [c, id] of [[alice, 'alice1'], [bob, 'bobby1'], [carol, 'carol1'], [dave, 'davey1']]) assert.equal((await signup(c, id)).status, 201);

  assert.deepEqual((await client()('GET', '/api/contributors')).body.items, [], '처음엔 비어 있음');

  // alice: 게임 제보(3) + 표지 사진(2) + 정보 수정(1) = 기본 6
  const g = (await alice('POST', '/api/submissions', { title: '앨리스 협동 게임', platforms: ['pc'], genres: ['puzzle'] })).body.item;
  const ph = (await alice('POST', '/api/games/igdb-82/image-submissions', { image: PNG, sourceUrl: 'https://press.example.com/kit' })).body.item;
  const fx = (await alice('POST', '/api/games/igdb-81/reports', { kind: 'fix', playersMin: 2, playersMax: 4 })).body.item;
  await admin('POST', `/api/admin/submissions/${g.id}/approve`);
  await admin('POST', `/api/admin/image-submissions/${ph.id}/approve`);
  await admin('POST', `/api/admin/reports/${fx.id}/approve`);
  // dave: 게임 제보 1개 = 3
  const d = (await dave('POST', '/api/submissions', { title: '데이브 게임', platforms: ['pc'], genres: ['puzzle'] })).body.item;
  await admin('POST', `/api/admin/submissions/${d.id}/approve`);
  // 관리자 직접 제보(바로 승인)는 순위에 없음
  await admin('POST', '/api/submissions', { title: '관리자 게임', platforms: ['pc'], genres: ['puzzle'] });

  const gid = `user-${g.id}`;
  // 반응: 다른 회원 찜 2(+2), 리뷰 1(+2), 사진 게임 찜 2 × 50%(+1) / 본인·관리자 찜은 안 셈
  for (const c of [bob, carol, alice, admin]) await c('PUT', `/api/wishlist/${gid}`);
  await bob('PUT', `/api/games/${gid}/reviews/mine`, { rating: 5, content: '재밌어요' });
  for (const c of [bob, carol]) await c('PUT', '/api/wishlist/igdb-82');
  // 조회: bob 2번(하루 1번만), carol 1번, alice(본인)·관리자는 안 셈
  for (const c of [bob, bob, carol, alice, admin]) await c('GET', `/api/games/${gid}`);

  const board = (await bob('GET', '/api/contributors?period=month')).body;
  assert.equal(board.items.length, 2, '관리자 제외');
  const [first, second] = board.items;
  assert.equal(first.nickname, 'alice1닉');
  assert.deepEqual({ score: first.score, base: first.base, reaction: first.reaction, games: first.games, photos: first.photos, infos: first.infos }, { score: 11, base: 6, reaction: 5, games: 1, photos: 1, infos: 1 });
  assert.equal(first.rank, 1);
  assert.deepEqual({ nickname: second.nickname, score: second.score, rank: second.rank }, { nickname: 'davey1닉', score: 3, rank: 2 });
  assert.ok(!JSON.stringify(board).includes('@example.com') && !JSON.stringify(board).includes('"alice1"'), '아이디·이메일 없음');
  assert.ok(first.badge, '대표 칭호');
  assert.equal(board.me.month.rank, null, 'bob은 순위 밖');
  assert.equal((await client()('GET', '/api/contributors')).body.me, null);
  assert.equal((await alice('GET', '/api/contributors?period=all')).body.me.all.rank, 1);

  const imp = (await alice('GET', '/api/me/impact')).body;
  assert.deepEqual({ games: imp.games, wishes: imp.wishes, reviews: imp.reviews, views: imp.views }, { games: 3, wishes: 4, reviews: 1, views: 2 });
  assert.equal(imp.items[0].gameId, gid);
  assert.equal(imp.rank.month.rank, 1);
  assert.equal((await client()('GET', '/api/me/impact')).status, 401);

  // 첫 리뷰 알림
  const n = (await alice('GET', '/api/me/notifications')).body.items;
  assert.ok(n.some((x) => x.kind === 'impact' && /‘앨리스 협동 게임’에 첫 리뷰가 달렸어요/.test(x.title)));
});

test('찜 이정표는 한 번만, 게임당 한 달 반응 상한', async () => {
  const db = openDb(':memory:');
  const t = '2026-11-05T00:00:00.000Z';
  await db.prepare("INSERT INTO users (login_id, nickname, email, password_hash, created_at) VALUES ('maker', 'maker', 'm@x.com', 'x', ?)").run(t);
  await db.prepare("INSERT INTO game_submissions (user_id, status, title, platforms, genres, created_at, reviewed_at) VALUES (1, 'approved', '인기 게임', '[\"pc\"]', '[\"puzzle\"]', ?, ?)").run(t, t);
  const sent = [];
  const c = createContributors(db, { notify: (uid, note) => sent.push([uid, note.title]), now: () => Date.parse('2026-11-20T00:00:00Z') });
  for (let i = 2; i <= 31; i++) {
    await db.prepare("INSERT INTO users (login_id, nickname, email, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)").run(`u${i}`, `u${i}`, `u${i}@x.com`, t);
    await db.prepare("INSERT INTO wishlist (user_id, game_id, title, created_at) VALUES (?, 'user-1', '인기 게임', '2026-11-10T00:00:00.000Z')").run(i);
    if (i === 6) await c.afterReaction('user-1');
  }
  await c.afterReaction('user-1');
  await c.afterReaction('user-1');
  const wishNotes = sent.filter(([, title]) => /찜했어요/.test(title)).map(([, title]) => title.match(/(\d+)명/)[1]);
  assert.deepEqual(wishNotes, ['5', '10'], '5명·10명 이정표 각각 한 번');
  const top = (await c.leaderboard({ period: 'month' })).items[0];
  assert.equal(top.reaction, MONTH_CAP, '찜 30개여도 한 달 20점');
  assert.equal(top.score, 3 + MONTH_CAP);
  // 지난달 승인은 이번 달 기본 점수에 없음
  assert.equal((await createContributors(db, { now: () => Date.parse('2026-12-03T00:00:00Z') }).leaderboard({ period: 'month' })).items.length, 0);
  assert.equal((await createContributors(db, { now: () => Date.parse('2026-12-03T00:00:00Z') }).leaderboard({ period: 'all' })).items[0].score, 23);
});
