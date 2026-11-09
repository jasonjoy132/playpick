// 관리자 '고쳐서 승인': 일부만 틀린 제보를 고쳐서 반영, 원래 값 기록, 알림에 고친 내용
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

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

// ── 관리자 '고쳐서 승인' ──
test('게임 제보 고쳐서 승인 → 고친 값 반영, 원래 값 기록, 알림에 고친 내용', async () => {
  const u = client();
  await signup(u, 'fixer1', 'fx1@example.com');
  const item = (await u('POST', '/api/submissions', { title: '고칠 게임', platforms: ['pc'], genres: ['puzzle'], playersMin: 2, playersMax: 8 })).body.item;
  const path = `/api/admin/submissions/${item.id}/approve`;
  // 회원은 못 함, 잘못된 값은 400이고 상태 그대로
  assert.equal((await u('POST', path, { edits: { playersMin: 2, playersMax: 4 } })).status, 403);
  assert.equal((await admin('POST', path, { edits: { playersMin: 5, playersMax: 2 } })).status, 400);
  assert.equal((await admin('POST', path, { edits: { storeUrl: 'https://evil.example.com/x' } })).status, 400);
  assert.equal((await u('GET', '/api/me/submissions')).body.items[0].status, 'pending');

  const r = await admin('POST', path, { edits: { playersMin: 2, playersMax: 4, platforms: ['pc', 'console'] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.status, 'approved');
  const game = (await u('GET', `/api/games/user-${item.id}`)).body.game;
  assert.deepEqual([game.recommendedPlayers.min, game.recommendedPlayers.max], [2, 4]);
  assert.ok(game.platforms.includes('console'));
  const mine = (await u('GET', '/api/me/submissions')).body.items.find((x) => x.id === item.id);
  assert.deepEqual(mine.edited.map((c) => [c.label, c.from, c.to]), [['플랫폼', 'PC', 'PC·콘솔'], ['추천 인원', '2~8명', '2~4명']]);
  const n = (await notes(u)).items.find((x) => x.kind === 'submission');
  assert.match(n.title, /일부 수정되어 승인됐어요/);
  assert.match(n.body, /추천 인원 2~8명 → 2~4명/);

  // 승인된 뒤 다시 고치기: 원래 값은 처음 것 유지, 알림 없음
  const before = (await notes(u)).items.length;
  const e = await admin('POST', `/api/admin/submissions/${item.id}/edit`, { edits: { playersMin: 3, playersMax: 4 } });
  assert.equal(e.status, 200);
  assert.deepEqual(e.body.item.edited.find((c) => c.field === 'players'), { field: 'players', label: '추천 인원', from: '2~8명', to: '3~4명' });
  assert.equal((await notes(u)).items.length, before);
  assert.equal((await admin('POST', `/api/admin/submissions/${item.id}/edit`, { edits: { playersMin: 3, playersMax: 4 } })).status, 400, '바뀐 게 없으면 오류');
});

test('정보 수정 제보 고쳐서 승인: 비운 칸은 반영 안 함', async () => {
  const u = client();
  await signup(u, 'fixer2', 'fx2@example.com');
  const item = (await u('POST', '/api/games/igdb-82/reports', { kind: 'fix', playersMin: 2, playersMax: 8, hours: 30 })).body.item;
  assert.equal((await admin('POST', `/api/admin/reports/${item.id}/approve`, { edits: { playersMin: '', playersMax: '', hours: '' } })).status, 400, '남는 값이 없으면 오류');
  const r = await admin('POST', `/api/admin/reports/${item.id}/approve`, { edits: { playersMin: 2, playersMax: 4, hours: '' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.item.fix, { players: { min: 2, max: 4 } });
  assert.deepEqual(r.body.item.edited.map((c) => `${c.label}:${c.from}→${c.to}`), ['추천 인원:2~8명→2~4명', '플레이 시간:30시간→(반영 안 함)']);
  const game = (await u('GET', '/api/games/igdb-82')).body.game;
  assert.deepEqual([game.recommendedPlayers.min, game.recommendedPlayers.max], [2, 4]);
  assert.notEqual(game.userPlaytime, 30);
  // 서비스 종료 제보는 고칠 수 없음
  const end = (await u('POST', '/api/games/igdb-82/reports', { kind: 'ended', sourceUrl: 'https://notice.example.com/x' })).body.item;
  assert.equal((await admin('POST', `/api/admin/reports/${end.id}/approve`, { edits: { hours: 3 } })).status, 400);
});
