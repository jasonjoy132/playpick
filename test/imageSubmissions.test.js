// 표지 사진 제보 → 관리자 승인 → 카드·상세 표지, 사진 칭호
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { validateSourceUrl } from '../server/community/imageSubmissions.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const GAMES = {
  'grac-NOIMG': { id: 'grac-NOIMG', title: '사진 없는 국내 게임', source: '게임물관리위원회', platforms: ['mobile'], genres: ['rpg'], players: null, stores: [], imageUrl: null, publisher: '테스트사' },
  'grac-NOIMG2': { id: 'grac-NOIMG2', title: '사진 없는 국내 게임 2', source: '게임물관리위원회', platforms: ['mobile'], genres: ['rpg'], players: null, stores: [], imageUrl: null },
  'igdb-1': { id: 'igdb-1', title: '사진 있는 게임', source: 'IGDB', platforms: ['pc'], genres: ['rpg'], players: null, stores: [], imageUrl: 'https://images.igdb.com/x.jpg', altNames: [] },
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  async browse() {
    return { games: Object.values(GAMES), hasMore: false };
  },
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['boss@example.com'] }, { catalog, partySize, mailer: { configured: false, devLog: false, send: async () => {} } });
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

test('출처 주소 검사', () => {
  assert.equal(validateSourceUrl(' https://play.google.com/store/apps/details?id=x '), 'https://play.google.com/store/apps/details?id=x');
  assert.throws(() => validateSourceUrl(''), /출처/);
  assert.throws(() => validateSourceUrl('javascript:alert(1)'), /http/);
  assert.throws(() => validateSourceUrl('not a url'), /올바르지/);
});

test('사진 제보 → 승인 → 표지·칭호, 거절·취소·중복, 사진 있는 게임은 불가', async () => {
  const anon = client();
  const path = '/api/games/grac-NOIMG/image-submissions';
  const body = { image: PNG, sourceUrl: 'https://example.com/official' };
  assert.equal((await anon('POST', path, body)).status, 401);

  const user = client();
  await user('POST', '/api/auth/signup', { loginId: 'photo1', password: 'secret123', nickname: '찍사', email: 'p@example.com' });
  const d0 = await user('GET', '/api/games/grac-NOIMG');
  assert.equal(d0.body.game.canSubmitImage, true);
  assert.equal((await user('GET', '/api/games/igdb-1')).body.game.canSubmitImage, false);
  assert.equal((await user('POST', '/api/games/igdb-1/image-submissions', body)).status, 409, '이미 사진이 있는 게임');
  assert.equal((await user('POST', path, { image: PNG })).status, 400, '출처 필수');
  assert.equal((await user('POST', path, { sourceUrl: body.sourceUrl })).status, 400, '사진 필수');

  const c = await user('POST', path, body);
  assert.equal(c.status, 201);
  assert.equal(c.body.item.status, 'pending');
  assert.match(c.body.item.imageUrl, /^\/submission-images\/p\d+-[a-f0-9]{16}\.png$/);
  assert.equal((await fetch(base + c.body.item.imageUrl)).status, 200, '사진 파일 제공');
  assert.equal((await user('POST', path, body)).status, 409, '같은 게임 검토 중 중복');
  const c2 = await user('POST', '/api/games/grac-NOIMG2/image-submissions', body);
  assert.equal((await user('DELETE', `/api/me/image-submissions/${c2.body.item.id}`)).status, 200, '검토 중 취소');
  assert.equal((await user('GET', '/api/me/image-submissions')).body.items.length, 1);

  // 승인 전: 표지 없음
  assert.equal((await anon('GET', '/api/games/grac-NOIMG')).body.game.imageUrl, null);
  assert.equal((await user('GET', '/api/admin/image-submissions')).status, 403);

  const admin = client();
  await admin('POST', '/api/auth/signup', { loginId: 'boss1', password: 'secret123', nickname: '운영자', email: 'boss@example.com' });
  const list = await admin('GET', '/api/admin/image-submissions?status=pending');
  assert.equal(list.body.counts.pending, 1);
  assert.equal(list.body.items[0].submitter, '찍사');
  assert.equal((await admin('POST', `/api/admin/image-submissions/${c.body.item.id}/approve`, {})).body.item.status, 'approved');

  const d1 = (await anon('GET', '/api/games/grac-NOIMG')).body.game;
  assert.equal(d1.imageUrl, c.body.item.imageUrl);
  assert.equal(d1.imageSource, '사용자 제보');
  assert.equal(d1.imageBy, '찍사');
  assert.equal(d1.imageSourceUrl, 'https://example.com/official');
  assert.equal(d1.imageByBadge.id, 'ph1', '사진 제보자 뱃지');
  assert.equal(d1.canSubmitImage, false, '사진이 생기면 제보 버튼 없음');
  const badges = (await user('GET', '/api/me/badges')).body;
  assert.ok(badges.badges.find((b) => b.id === 'ph1').earned);
  assert.equal(badges.badges.find((b) => b.id === 'ph1').image, '/badge-ph1.webp');
  assert.equal(badges.nextPhoto.id, 'ph2');
  assert.equal(badges.stats.photos, 1);
  assert.equal(badges.display.id, 'ph1');
  const me = (await user('GET', '/api/auth/me')).body.user;
  assert.ok(me.newBadges.some((b) => b.id === 'ph1'), '새 칭호 알림');

  // 관리자 직접 등록은 바로 승인
  const direct = await admin('POST', '/api/games/grac-NOIMG2/image-submissions', body);
  assert.equal(direct.body.item.status, 'approved');
  assert.ok((await anon('GET', '/api/games/grac-NOIMG2')).body.game.imageUrl);

  // 내리면 표지·칭호 빠짐, 사유는 내 제보에
  assert.equal((await admin('POST', `/api/admin/image-submissions/${c.body.item.id}/reject`, { reason: '' })).status, 400);
  await admin('POST', `/api/admin/image-submissions/${c.body.item.id}/reject`, { reason: '다른 게임 사진' });
  assert.equal((await anon('GET', '/api/games/grac-NOIMG')).body.game.imageUrl, null);
  assert.equal((await user('GET', '/api/me/badges')).body.stats.photos, 0);
  assert.equal((await user('GET', '/api/me/image-submissions')).body.items[0].rejectReason, '다른 게임 사진');
  assert.equal((await user('DELETE', `/api/me/image-submissions/${c.body.item.id}`)).status, 409, '처리된 제보는 취소 불가');
});

test('목록 숨김: 종료는 숨김, 출시 예정은 출시 예정 목록에서만, 모름은 설정(HIDE_UNKNOWN_GRAC)에 따라', async () => {
  const G = (id, extra = {}) => ({ id, title: id, source: '게임물관리위원회', platforms: ['pc'], genres: ['rpg'], players: null, stores: [], imageUrl: null, ...extra });
  const games = [G('grac-ALIVE', { aiAlive: true }), G('grac-UNKNOWN'), G('grac-ENDED', { aiEnded: true, aiAlive: false }), G('grac-UP', { aiUpcoming: true }), G('grac-STORE', { appStoreUrl: 'https://apps.apple.com/kr/app/x/id1' })];
  const cat = {
    meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
    getGame: async (id) => games.find((g) => g.id === id) ?? null,
    browse: async () => ({ games, hasMore: false }),
    search: async () => ({ games, warnings: [] }),
    domesticGames: () => games,
  };
  const ps = { size: 10, configured: true, applyCached: (g) => g, fill: async (g) => ({ games: g, warning: null }) };
  // 기본: '모름'도 보임 (종료는 숨김, 출시 예정은 출시 예정 목록에만)
  const plain = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, hideUnknownGrac: false }, { catalog: cat, partySize: ps });
  await new Promise((r) => plain.listen(0, r));
  try {
    const r = await (await fetch(`http://127.0.0.1:${plain.address().port}/api/search?q=x`)).json();
    assert.deepEqual(r.games.map((g) => g.id).sort(), ['grac-ALIVE', 'grac-STORE', 'grac-UNKNOWN']);
  } finally {
    plain.close();
  }
  // HIDE_UNKNOWN_GRAC=on: '모름'도 숨김
  const srv = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, hideUnknownGrac: true }, { catalog: cat, partySize: ps });
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ids = (r) => r.games.map((g) => g.id).sort();
    const search = await (await fetch(`${b}/api/search?q=x`)).json();
    assert.deepEqual(ids(search), ['grac-ALIVE', 'grac-STORE']);
    const popular = await (await fetch(`${b}/api/browse/popular`)).json();
    assert.deepEqual(ids(popular), ['grac-ALIVE', 'grac-STORE']);
    const up = await (await fetch(`${b}/api/browse/upcoming`)).json();
    assert.deepEqual(up.domestic.map((g) => g.id), ['grac-UP'], '출시 예정은 출시 예정 목록에만');
    assert.equal((await fetch(`${b}/api/games/grac-UNKNOWN`)).status, 200, '상세는 열림');
  } finally {
    srv.close();
  }
});
