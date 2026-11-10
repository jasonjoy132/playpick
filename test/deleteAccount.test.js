// 회원 탈퇴: 비밀번호·확인 문구, 계정·세션·찜·리뷰·알림·검토 중 제보·프로필 사진 삭제, 승인된 제보는 작성자 없이 남음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const avatarsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-del-avatars-'));

const GAMES = {
  'igdb-91': { id: 'igdb-91', title: '탈퇴 테스트 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: 'https://x/y.jpg', altNames: [] },
  'igdb-92': { id: 'igdb-92', title: '정보 수정 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: 'https://x/z.jpg', altNames: [] },
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
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['boss@example.com'], avatarsDir },
    { catalog, partySize, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(avatarsDir, { recursive: true, force: true });
});

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
    return { status: res.status, set, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
}
const account = { loginId: 'leaver1', password: 'secret123', nickname: '떠나는이', email: 'leaver@example.com' };

test('탈퇴: 로그인·비밀번호·확인 문구 검사 → 지울 것만 지우고 승인된 제보는 남김', async () => {
  assert.equal((await client()('POST', '/api/me/delete', { password: 'x', confirm: '탈퇴' })).status, 401, '로그인 필요');

  const admin = client();
  assert.equal((await admin('POST', '/api/auth/signup', { loginId: 'boss', password: 'secret123', nickname: '보스', email: 'boss@example.com' })).status, 201);
  const u = client();
  assert.equal((await u('POST', '/api/auth/signup', account)).status, 201);
  const other = client();
  await other('POST', '/api/auth/signup', { loginId: 'stayer1', password: 'secret123', nickname: '남는이', email: 'stay@example.com' });

  // 활동: 프로필 사진·찜·리뷰·제보(승인 1, 검토 중 1)
  const avatarUrl = (await u('PUT', '/api/me/avatar', { dataUrl: PNG_1x1 })).body.user.avatarUrl;
  const avatarFile = path.join(avatarsDir, path.basename(avatarUrl));
  assert.ok(fs.existsSync(avatarFile));
  await u('PUT', '/api/wishlist/igdb-91');
  await u('PUT', '/api/games/igdb-91/reviews/mine', { rating: 1, content: '별로' });
  await other('PUT', '/api/games/igdb-91/reviews/mine', { rating: 5, content: '최고' });
  const ok = (await u('POST', '/api/submissions', { title: '남을 제보 게임', platforms: ['pc'], genres: ['puzzle'] })).body.item;
  const pend = (await u('POST', '/api/submissions', { title: '사라질 제보 게임', platforms: ['pc'], genres: ['puzzle'] })).body.item;
  const fixRes = await u('POST', '/api/games/igdb-92/reports', { kind: 'fix', playersMin: 2, playersMax: 4 });
  const fix = fixRes.body.item;
  assert.ok(fix?.id);
  await admin('POST', `/api/admin/submissions/${ok.id}/approve`);
  assert.equal((await u('GET', '/api/games/igdb-91/reviews')).body.stats.avg, 3);

  // 틀린 비밀번호 / 확인 문구 없음 → 그대로
  assert.equal((await u('POST', '/api/me/delete', { password: 'wrong999', confirm: '탈퇴' })).status, 400);
  assert.equal((await u('POST', '/api/me/delete', { password: 'secret123', confirm: '' })).status, 400);
  assert.equal((await u('GET', '/api/auth/me')).body.user.loginId, 'leaver1');

  const del = await u('POST', '/api/me/delete', { password: 'secret123', confirm: '탈퇴' });
  assert.equal(del.status, 200);
  assert.match(del.set, /Max-Age=0/, '쿠키 지움');

  // 세션 끊김·로그인 불가
  assert.equal((await u('GET', '/api/auth/me')).body.user, null);
  assert.equal((await client()('POST', '/api/auth/login', { loginId: 'leaver1', password: 'secret123' })).status, 401);
  // 프로필 사진 파일 삭제
  assert.equal(fs.existsSync(avatarFile), false);
  // 리뷰 삭제 → 평점 다시 계산
  const reviews = (await other('GET', '/api/games/igdb-91/reviews')).body;
  assert.equal(reviews.reviews.length, 1);
  assert.equal(reviews.stats.avg, 5);
  // 승인된 제보 게임은 남고 제보자는 비어 있음, 검토 중 제보는 사라짐
  const game = (await other('GET', `/api/games/user-${ok.id}`)).body.game;
  assert.equal(game.title, '남을 제보 게임');
  assert.equal(game.submittedBy, null);
  const pending = (await admin('GET', '/api/admin/submissions?status=pending')).body;
  assert.ok(!JSON.stringify(pending).includes('사라질 제보 게임'));
  assert.ok(!JSON.stringify((await admin('GET', '/api/admin/reports?kind=fix&status=pending')).body).includes(`"id":${fix.id},`));
  assert.ok(pend.id);

  // 같은 아이디·이메일로 다시 가입, 예전 찜·알림 없음
  const again = client();
  assert.equal((await again('POST', '/api/auth/signup', account)).status, 201);
  assert.equal((await again('GET', '/api/wishlist')).body.items.length, 0);
  assert.equal((await again('GET', '/api/me/notifications')).body.items.length, 1, '새 환영 알림만');
});
