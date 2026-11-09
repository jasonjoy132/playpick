// 알림: 제보 승인·거절, 리뷰 숨김, 새 칭호, 찜한 게임 종료, 가입 환영, 읽음 처리
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createNotifications } from '../server/community/notifications.js';

const GAMES = {
  'igdb-81': { id: 'igdb-81', title: '알림 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: 'https://x/y.jpg', altNames: [] },
  'igdb-82': { id: 'igdb-82', title: '사진 없는 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: null, altNames: [] },
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  browse: async () => ({ games: Object.values(GAMES), hasMore: false }),
  search: async () => ({ games: Object.values(GAMES), warnings: [] }),
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

let server, base;
before(async () => {
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['boss@example.com'] },
    { catalog, partySize, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
}
const signup = (c, id, email) => c('POST', '/api/auth/signup', { loginId: id, password: 'secret123', nickname: id, email });
const notes = async (c) => (await c('GET', '/api/me/notifications')).body;

let admin;
test('관리자 준비', async () => {
  admin = client();
  assert.equal((await signup(admin, 'boss', 'boss@example.com')).status, 201);
});

test('가입하면 환영 알림, 로그인 안 하면 알림을 볼 수 없음', async () => {
  assert.equal((await client()('GET', '/api/me/notifications')).status, 401);
  const u = client();
  await signup(u, 'newbie', 'newbie@example.com');
  const n = await notes(u);
  assert.equal(n.unread, 1);
  assert.equal(n.items[0].kind, 'welcome');
  assert.equal(n.pending, null, '관리자가 아니면 대기 건수 없음');
});

test('게임 제보 거절·승인 → 제보한 사람에게 알림(사유 포함), 새 칭호 알림', async () => {
  const u = client();
  await signup(u, 'reporter1', 'r1@example.com');
  const g = { title: '알림 테스트 게임', platforms: ['pc'], genres: ['puzzle'] };
  const a = (await u('POST', '/api/submissions', g)).body.item;
  const b = (await u('POST', '/api/submissions', { ...g, title: '거절될 알림 게임' })).body.item;
  assert.ok((await notes(admin)).pending >= 2, '관리자는 검토 대기 수');

  assert.equal((await admin('POST', `/api/admin/submissions/${b.id}/reject`, { reason: '이미 있는 게임이에요' })).status, 200);
  let n = await notes(u);
  assert.match(n.items[0].title, /‘거절될 알림 게임’ 게임 제보가 거절됐어요/);
  assert.equal(n.items[0].body, '사유: 이미 있는 게임이에요');
  assert.equal(n.items[0].tone, 'no');

  await admin('POST', `/api/admin/submissions/${a.id}/approve`);
  n = await notes(u);
  const ok = n.items.find((x) => x.tone === 'ok');
  assert.match(ok.title, /‘알림 테스트 게임’ 게임 제보가 승인됐어요/);
  assert.equal(ok.link, `/games/user-${a.id}`);
  assert.ok(n.items.some((x) => x.kind === 'badge'), '첫 승인으로 칭호');
  assert.equal(n.unread, n.items.length, '모두 안 읽음');

  // 승인 취소
  await admin('POST', `/api/admin/submissions/${a.id}/reject`, { reason: '정보가 틀렸어요' });
  assert.match((await notes(u)).items[0].title, /승인이 취소됐어요/);

  // 관리자 자신의 화면에는 남의 제보 알림이 없음
  assert.ok(!(await notes(admin)).items.some((x) => x.kind === 'submission'));
});

test('관리자가 자기 제보를 처리하면 알림 없음', async () => {
  const before = (await notes(admin)).items.length;
  const r = (await admin('POST', '/api/games/igdb-81/reports', { kind: 'fix', playersMin: 2, playersMax: 4 })).body.item;
  assert.equal(r.status, 'approved', '관리자는 바로 승인');
  await admin('POST', `/api/admin/reports/${r.id}/reject`, { reason: '되돌림' });
  assert.equal((await notes(admin)).items.filter((x) => x.kind === 'report').length, 0);
  assert.ok((await notes(admin)).items.length >= before);
});

test('표지 사진 제보 승인 → 게임 상세 링크', async () => {
  const u = client();
  await signup(u, 'photo1', 'p1@example.com');
  const item = (await u('POST', '/api/games/igdb-82/image-submissions', { image: PNG, sourceUrl: 'https://press.example.com/kit' })).body.item;
  assert.ok(item, '사진 제보');
  await admin('POST', `/api/admin/image-submissions/${item.id}/approve`);
  const ok = (await notes(u)).items.find((x) => x.kind === 'image');
  assert.match(ok.title, /표지 사진 제보가 승인됐어요/);
  assert.equal(ok.link, '/games/igdb-82');
});

test('서비스 종료 제보 승인 → 찜한 회원에게 알림(제보한 사람 제외)', async () => {
  const fan = client();
  const ender = client();
  await signup(fan, 'fan1', 'fan1@example.com');
  await signup(ender, 'ender9', 'ender9@example.com');
  await fan('PUT', '/api/wishlist/igdb-81');
  await ender('PUT', '/api/wishlist/igdb-81');
  const r = (await ender('POST', '/api/games/igdb-81/reports', { kind: 'ended', sourceUrl: 'https://notice.example.com/end' })).body.item;
  await admin('POST', `/api/admin/reports/${r.id}/approve`);
  const f = (await notes(fan)).items.find((x) => x.kind === 'wish');
  assert.match(f.title, /찜한 ‘알림 게임’의 서비스가 종료됐어요/);
  const e = await notes(ender);
  assert.ok(e.items.some((x) => x.kind === 'report' && x.tone === 'ok'), '제보한 사람은 승인 알림');
  assert.ok(!e.items.some((x) => x.kind === 'wish'), '제보한 사람은 찜 알림 없음');
  await admin('POST', `/api/admin/reports/${r.id}/reject`, { reason: '아직 서비스 중' }); // 다른 테스트를 위해 되돌림
});

test('리뷰가 신고로 숨겨지면·다시 보이면 작성자에게 알림, 첫 리뷰 칭호 알림', async () => {
  const writer = client();
  const other = client();
  await signup(writer, 'writer1', 'w1@example.com');
  await signup(other, 'other1', 'o1@example.com');
  await writer('PUT', '/api/games/igdb-81/reviews/mine', { rating: 5, content: '정말 재밌어요' });
  assert.ok((await notes(writer)).items.some((x) => x.kind === 'badge'), '첫 리뷰 칭호');
  const reviewId = (await other('GET', '/api/games/igdb-81/reviews')).body.reviews.find((r) => r.nickname === 'writer1' || r.author === 'writer1')?.id;
  assert.ok(reviewId);
  await other('POST', `/api/reviews/${reviewId}/report`, { reason: 'spam' });
  await admin('POST', `/api/admin/review-reports/${reviewId}/hide`);
  let n = await notes(writer);
  assert.match(n.items[0].title, /리뷰가 숨김 처리됐어요/);
  await admin('POST', `/api/admin/review-reports/${reviewId}/restore`);
  n = await notes(writer);
  assert.match(n.items[0].title, /리뷰가 다시 보이게 됐어요/);
});

test('읽음 처리: 하나·모두, 남의 알림은 못 읽음', async () => {
  const u = client();
  const v = client();
  await signup(u, 'reader1', 'rd1@example.com');
  await signup(v, 'reader2', 'rd2@example.com');
  const mine = (await notes(u)).items[0];
  const theirs = (await notes(v)).items[0];
  assert.equal((await u('POST', '/api/me/notifications/read', { ids: [theirs.id] })).body.unread, 1, '남의 알림 id는 무시');
  assert.equal((await notes(v)).unread, 1);
  const r = await u('POST', '/api/me/notifications/read', { ids: [mine.id] });
  assert.equal(r.body.unread, 0);
  assert.equal((await u('GET', '/api/me/notifications/count')).body.unread, 0);
  assert.equal((await u('POST', '/api/me/notifications/read', {})).status, 400);
  assert.equal((await v('POST', '/api/me/notifications/read', { all: true })).body.unread, 0);
});

test('사용자마다 최근 100개만 남김', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (login_id, nickname, email, password_hash, created_at) VALUES ('a', 'a', 'a@x.com', 'x', '2026')").run();
  const n = createNotifications(db);
  for (let i = 0; i < 120; i++) n.add(1, { kind: 'info', title: `알림 ${i}` });
  const list = n.list(1);
  assert.equal(list.items.length, 30, '목록은 최근 30개');
  assert.equal(list.items[0].title, '알림 119');
  assert.equal(list.unread, 100);
});

