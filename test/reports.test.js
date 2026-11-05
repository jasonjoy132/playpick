// 서비스 종료 제보·정보 수정 제보·리뷰 신고
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { validateFix } from '../server/community/reports.js';

const GAMES = {
  'igdb-71': { id: 'igdb-71', title: '버블 테스트', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: { min: 1, max: 8 }, recommendedPlayers: { min: 1, max: 8, source: 'igdb' }, stores: [], imageUrl: 'https://x/y.jpg', altNames: [] },
  'igdb-72': { id: 'igdb-72', title: '다른 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: 'https://x/z.jpg', altNames: [] },
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  browse: async () => ({ games: Object.values(GAMES), hasMore: false }),
  search: async () => ({ games: Object.values(GAMES), warnings: [] }),
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

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
const signup = async (c, id, email) => c('POST', '/api/auth/signup', { loginId: id, password: 'secret123', nickname: id, email });
const ids = (r) => r.body.games.map((g) => g.id).sort();

test('정보 수정 값 검사', () => {
  assert.deepEqual(validateFix({ playersMin: '1', playersMax: '4', hours: '30', storeUrl: 'https://store.steampowered.com/app/1/' }), { players: { min: 1, max: 4 }, hours: 30, storeUrl: 'https://store.steampowered.com/app/1/' });
  assert.throws(() => validateFix({ playersMin: 5, playersMax: 2 }), /추천 인원/);
  assert.throws(() => validateFix({ hours: 0 }), /플레이 시간/);
  assert.throws(() => validateFix({ storeUrl: 'https://evil.example.com' }), /공식 스토어/);
  assert.deepEqual(validateFix({}), {});
});

test('서비스 종료 제보 → 승인 → 목록·검색에서 숨김, 내리면 다시 보임', async () => {
  const user = client();
  await signup(user, 'ender1', 'e1@example.com');
  const path = '/api/games/igdb-71/reports';
  assert.equal((await client()('POST', path, { kind: 'ended', sourceUrl: 'https://notice.example.com' })).status, 401);
  assert.equal((await user('POST', path, { kind: 'ended' })).status, 400, '근거 주소 필수');
  const c = await user('POST', path, { kind: 'ended', sourceUrl: 'https://notice.example.com/1', note: '2023년 종료 공지' });
  assert.equal(c.status, 201);
  assert.equal((await user('POST', path, { kind: 'ended', sourceUrl: 'https://notice.example.com/1' })).status, 409, '같은 제보 중복');
  assert.deepEqual(ids(await user('GET', '/api/search?q=x')), ['igdb-71', 'igdb-72'], '승인 전엔 그대로');

  const admin = client();
  await signup(admin, 'boss1', 'boss@example.com');
  assert.equal((await user('GET', '/api/admin/reports?kind=ended')).status, 403);
  const list = await admin('GET', '/api/admin/reports?kind=ended');
  assert.equal(list.body.counts.pending, 1);
  assert.equal(list.body.items[0].submitter, 'ender1');
  await user('PUT', '/api/wishlist/igdb-71');
  await user('GET', '/api/games/igdb-71'); // 최근 본 게임
  await admin('POST', `/api/admin/reports/${c.body.item.id}/approve`, {});
  assert.deepEqual(ids(await user('GET', '/api/search?q=x')), ['igdb-72'], '승인되면 검색에서 숨김');
  assert.deepEqual(ids(await user('GET', '/api/browse/popular')), ['igdb-72'], '목록에서도');
  // 상세도 안 보임(서비스 종료), 찜·최근 본 게임에서도 빠짐. 관리자는 확인용으로 열 수 있음
  assert.deepEqual((await user('GET', '/api/wishlist')).body.items.map((w) => w.gameId), [], '찜 목록에서 빠짐');
  assert.deepEqual((await user('GET', '/api/me/recent')).body.items.map((w) => w.gameId), [], '최근 본 게임에서 빠짐');
  const gone = await user('GET', '/api/games/igdb-71');
  assert.equal(gone.status, 410);
  assert.equal(gone.body.error.code, 'ENDED');
  const d = (await admin('GET', '/api/games/igdb-71')).body.game;
  assert.equal(d.userEnded, true, '관리자에게는 열리고 종료 표시');
  assert.equal(d.endedSourceUrl, 'https://notice.example.com/1');
  assert.equal((await user('GET', '/api/me/reports')).body.items[0].status, 'approved');
  const b1 = (await user('GET', '/api/me/badges')).body;
  assert.ok(b1.badges.find((b) => b.id === 'if1').earned, '정보 지킴이');
  assert.equal(b1.stats.reports, 1);
  assert.equal(b1.nextInfo.id, 'if2');
  assert.ok((await user('GET', '/api/auth/me')).body.user.newBadges.some((b) => b.id === 'if1'), '새 칭호 알림');

  await admin('POST', `/api/admin/reports/${c.body.item.id}/reject`, { reason: '아직 서비스 중' });
  assert.equal((await user('GET', '/api/me/badges')).body.stats.reports, 0, '되돌리면 실적에서 빠짐');
  assert.deepEqual(ids(await user('GET', '/api/search?q=x')), ['igdb-71', 'igdb-72'], '내리면 다시 보임');
  assert.deepEqual((await user('GET', '/api/wishlist')).body.items.map((w) => w.gameId), ['igdb-71'], '찜 목록에도 다시');
  assert.equal((await user('GET', '/api/games/igdb-71')).status, 200, '상세도 다시 열림');
});

test('정보 수정 제보 → 승인 → 추천 인원·플레이 시간·구매처 반영, 관리자는 바로 반영', async () => {
  const user = client();
  await signup(user, 'fixer1', 'f1@example.com');
  const path = '/api/games/igdb-72/reports';
  assert.equal((await user('POST', path, { kind: 'fix' })).status, 400, '내용 필요');
  const c = await user('POST', path, { kind: 'fix', playersMin: 2, playersMax: 4, hours: 25, storeUrl: 'https://store.steampowered.com/app/999/', note: '공식 홈페이지 기준' });
  assert.equal(c.status, 201);
  assert.deepEqual(c.body.item.fix, { players: { min: 2, max: 4 }, hours: 25, storeUrl: 'https://store.steampowered.com/app/999/' });
  const r = await user('DELETE', `/api/me/reports/${c.body.item.id}`);
  assert.equal(r.status, 200, '검토 중 취소');

  const admin = client();
  await admin('POST', '/api/auth/login', { loginId: 'boss1', password: 'secret123' });
  const direct = await admin('POST', path, { kind: 'fix', playersMin: 2, playersMax: 4, hours: 25, storeUrl: 'https://store.steampowered.com/app/999/' });
  assert.equal(direct.body.item.status, 'approved', '관리자는 바로 반영');
  const g = (await user('GET', '/api/games/igdb-72')).body.game;
  assert.deepEqual(g.recommendedPlayers, { min: 2, max: 4, source: 'user' });
  assert.deepEqual(g.playtime, { hours: 25, source: 'user' });
  assert.ok(g.stores.some((s) => s.url === 'https://store.steampowered.com/app/999/'));
});

test('리뷰 신고 → 관리자 숨김 → 다른 사람에게 안 보이고 평점에서 빠짐, 다시 보이기', async () => {
  const author = client();
  await signup(author, 'writer1', 'w1@example.com');
  await author('PUT', '/api/games/igdb-72/reviews/mine', { rating: 1, content: '광고 리뷰 http://spam' });
  const reviewer = client();
  await signup(reviewer, 'reader1', 'r1@example.com');
  const list = (await reviewer('GET', '/api/games/igdb-72/reviews')).body;
  const rid = list.reviews[0].id;
  assert.equal((await author('POST', `/api/reviews/${rid}/report`, { reason: 'spam' })).status, 400, '내 리뷰는 신고 불가');
  assert.equal((await reviewer('POST', `/api/reviews/${rid}/report`, { reason: 'zzz' })).status, 400, '사유 필수');
  assert.equal((await reviewer('POST', `/api/reviews/${rid}/report`, { reason: 'spam', note: '광고' })).status, 201);
  assert.equal((await reviewer('POST', `/api/reviews/${rid}/report`, { reason: 'spam' })).status, 409, '중복 신고');
  assert.equal((await reviewer('GET', '/api/games/igdb-72/reviews')).body.reviews[0].reported, true, '신고함 표시');

  const admin = client();
  await admin('POST', '/api/auth/login', { loginId: 'boss1', password: 'secret123' });
  const rr = (await admin('GET', '/api/admin/review-reports')).body;
  assert.equal(rr.counts.pending, 1);
  assert.equal(rr.items[0].reports[0].reasonText, '광고·도배');
  assert.equal(rr.items[0].author, 'writer1');
  await admin('POST', `/api/admin/review-reports/${rid}/hide`, {});
  const cl = (await reviewer('GET', '/api/me/badges')).body.badges.find((b) => b.id === 'cleaner');
  assert.equal(cl.have, 1, '숨겨진 신고 1/3');
  const after = (await reviewer('GET', '/api/games/igdb-72/reviews')).body;
  assert.equal(after.reviews.length, 0, '다른 사람에게 안 보임');
  assert.equal(after.stats.count, 0, '평점에서 빠짐');
  const own = (await author('GET', '/api/games/igdb-72/reviews')).body.reviews[0];
  assert.equal(own.hidden, true, '작성자에게는 숨김 표시와 함께 보임');
  assert.equal((await admin('GET', '/api/admin/review-reports?status=upheld')).body.items.length, 1);

  await admin('POST', `/api/admin/review-reports/${rid}/restore`, {});
  assert.equal((await reviewer('GET', '/api/games/igdb-72/reviews')).body.reviews.length, 1, '다시 보이기');
});
