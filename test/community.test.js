import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

let server, base;
const mails = [];
const mailer = { configured: true, devLog: false, send: async (m) => mails.push(m) };

before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', baseUrl: 'http://pp.test' }, { mailer });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, body: await res.json(), setCookie: set };
  };
  return { call, get cookie() { return cookie; } };
}

const ALICE = { loginId: 'alice_01', password: 'secret123', nickname: '앨리스', email: 'alice@example.com' };

test('회원가입: 검증, 중복, 쿠키 설정(HttpOnly·SameSite)', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/api/auth/signup', { ...ALICE, loginId: 'A!' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/signup', { ...ALICE, password: 'short' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/signup', { ...ALICE, password: 'onlyletters' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/signup', { ...ALICE, email: 'nope' })).status, 400);
  const r = await c.call('POST', '/api/auth/signup', ALICE);
  assert.equal(r.status, 201);
  assert.equal(r.body.user.nickname, '앨리스');
  assert.equal(r.body.user.password_hash, undefined);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Lax/);
  assert.equal((await c.call('GET', '/api/auth/me')).body.user.loginId, 'alice_01');
  const dup = client();
  assert.equal((await dup.call('POST', '/api/auth/signup', { ...ALICE, nickname: '다른', email: 'x@example.com' })).body.error.code, 'DUPLICATE_LOGIN_ID');
  assert.equal((await dup.call('POST', '/api/auth/signup', { ...ALICE, loginId: 'other1', email: 'x@example.com' })).body.error.code, 'DUPLICATE_NICKNAME');
  assert.equal((await dup.call('POST', '/api/auth/signup', { ...ALICE, loginId: 'other1', nickname: '다른' })).body.error.code, 'DUPLICATE_EMAIL');
});

test('로그인·로그아웃, 틀린 비밀번호, CSRF 헤더 필수', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'alice_01', password: 'wrong1234' })).status, 401);
  assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'nobody', password: 'wrong1234' })).body.error.message, '아이디 또는 비밀번호가 올바르지 않습니다.');
  assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'ALICE_01', password: 'secret123' })).status, 200, '아이디 대소문자 무시');
  assert.equal((await c.call('GET', '/api/auth/me')).body.user.nickname, '앨리스');
  assert.equal((await c.call('POST', '/api/auth/logout', {}, {})).status, 200);
  assert.equal((await c.call('GET', '/api/auth/me')).body.user, null);
  // 헤더 없는 요청(다른 사이트 폼 등) 거부
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const res2 = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res2.status, 403);
});

test('로그인 시도 제한 (5회 실패 후 429)', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'limit_me', password: 'wrong1234' })).status, 401);
  assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'limit_me', password: 'wrong1234' })).status, 429);
});

test('찜: 로그인 필요, 추가·목록·삭제, 목록에 찜 여부 표시', async () => {
  const anon = client();
  assert.equal((await anon.call('PUT', '/api/wishlist/demo-02')).status, 401);
  const c = client();
  await c.call('POST', '/api/auth/login', { loginId: 'alice_01', password: 'secret123' });
  assert.equal((await c.call('PUT', '/api/wishlist/demo-02')).body.wished, true);
  assert.equal((await c.call('PUT', '/api/wishlist/demo-99')).status, 404, '없는 게임');
  assert.equal((await c.call('PUT', '/api/wishlist/..%2Fetc')).status, 400);
  const list = (await c.call('GET', '/api/wishlist')).body.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '던전 동맹', '제목은 서버가 조회한 값');
  assert.equal((await c.call('GET', '/api/games/demo-02')).body.game.wished, true);
  assert.equal((await anon.call('GET', '/api/games/demo-02')).body.game.wished, false);
  await c.call('DELETE', '/api/wishlist/demo-02');
  assert.equal((await c.call('GET', '/api/wishlist')).body.items.length, 0);
});

test('별점·리뷰: 작성(1인 1리뷰, 수정 불가)·평균·삭제 후 재작성, 남의 리뷰 표시', async () => {
  const a = client();
  await a.call('POST', '/api/auth/login', { loginId: 'alice_01', password: 'secret123' });
  const b = client();
  const sb = await b.call('POST', '/api/auth/signup', { loginId: 'bob_02', password: 'secret456', nickname: '밥아저씨', email: 'bob@example.com' });
  assert.equal(sb.status, 201, JSON.stringify(sb.body));
  assert.equal((await a.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 6, content: 'x' })).status, 400);
  assert.equal((await a.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 4, content: '<b>재밌어요</b>' })).status, 200);
  const again = await a.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 1, content: '바꾸기' });
  assert.equal(again.status, 409, '수정 불가');
  assert.equal(again.body.error.code, 'ALREADY_REVIEWED');
  const r = await b.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 3, content: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stats.count, 2);
  assert.equal(r.body.stats.avg, 3.5);
  assert.equal(r.body.stats.distribution[4], 1);
  const view = (await a.call('GET', '/api/games/demo-01/reviews')).body;
  assert.equal(view.reviews.length, 2);
  const mine = view.reviews.find((x) => x.mine);
  assert.equal(mine.content, '<b>재밌어요</b>', '그대로 저장(화면에서는 글자로 표시)');
  assert.equal(mine.nickname, '앨리스');
  assert.equal(view.reviews.find((x) => !x.mine).nickname, '밥아저씨');
  const featured = (await a.call('GET', '/api/featured')).body.games;
  assert.deepEqual(featured.find((g) => g.id === 'demo-01').userRating, { count: 2, avg: 3.5 });
  const del = await b.call('DELETE', '/api/games/demo-01/reviews/mine');
  assert.equal(del.body.stats.avg, 4);
  assert.equal((await b.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 5 })).status, 200, '삭제 후 다시 작성 가능');
  assert.equal((await client().call('PUT', '/api/games/demo-01/reviews/mine', { rating: 5 })).status, 401);
  assert.equal((await a.call('PUT', '/api/games/demo-02/reviews/mine', { rating: 5, content: 'x'.repeat(1001) })).status, 400);
});

test('아이디 찾기: 가입 이메일에만 메일, 응답은 동일', async () => {
  mails.length = 0;
  const c = client();
  assert.deepEqual((await c.call('POST', '/api/auth/find-id', { email: 'alice@example.com' })).body, { ok: true });
  assert.deepEqual((await c.call('POST', '/api/auth/find-id', { email: 'nobody@example.com' })).body, { ok: true });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'alice@example.com');
  assert.ok(mails[0].lines.some((l) => l.includes('alice_01')));
});

test('비밀번호 재설정: 메일 링크 → 새 비밀번호, 링크 1회용, 기존 세션 로그아웃', async () => {
  mails.length = 0;
  const old = client();
  await old.call('POST', '/api/auth/login', { loginId: 'alice_01', password: 'secret123' });
  const c = client();
  await c.call('POST', '/api/auth/reset-request', { loginId: 'alice_01', email: 'wrong@example.com' });
  assert.equal(mails.length, 0, '이메일이 다르면 발송 안 함');
  await c.call('POST', '/api/auth/reset-request', { loginId: 'alice_01', email: 'alice@example.com' });
  assert.equal(mails.length, 1);
  assert.match(mails[0].link, /^http:\/\/pp\.test\/reset-password\?token=/);
  const token = new URL(mails[0].link).searchParams.get('token');
  assert.equal((await c.call('POST', '/api/auth/reset', { token, password: 'weak' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/reset', { token, password: 'newpass789' })).status, 200);
  assert.equal((await c.call('POST', '/api/auth/reset', { token, password: 'again12345' })).body.error.code, 'INVALID_TOKEN');
  assert.equal((await old.call('GET', '/api/auth/me')).body.user, null, '다른 기기 세션 종료');
  assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'alice_01', password: 'newpass789' })).status, 200);
});

test('메일 설정이 없으면 찾기 기능은 명확한 오류(보낸 척 안 함)', async () => {
  const s = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', mail: {} });
  await new Promise((r) => s.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/find-id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick' }, body: JSON.stringify({ email: 'a@example.com' }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'MAIL_NOT_CONFIGURED');
  } finally {
    s.close();
  }
});

test('마이페이지: 닉네임 변경·중복, 비밀번호 변경(현재 비번 확인, 다른 기기 로그아웃)', async () => {
  const c = client();
  await c.call('POST', '/api/auth/signup', { loginId: 'carol_3', password: 'carol1234', nickname: '캐롤', email: 'carol@example.com' });
  const other = client();
  await other.call('POST', '/api/auth/login', { loginId: 'carol_3', password: 'carol1234' });
  assert.equal((await client().call('PATCH', '/api/me/profile', { nickname: '새이름' })).status, 401);
  assert.equal((await c.call('PATCH', '/api/me/profile', { nickname: '밥아저씨' })).body.error.code, 'DUPLICATE_NICKNAME');
  assert.equal((await c.call('PATCH', '/api/me/profile', { nickname: '!' })).status, 400);
  assert.equal((await c.call('PATCH', '/api/me/profile', { nickname: '캐롤리나' })).body.user.nickname, '캐롤리나');
  assert.equal((await c.call('PATCH', '/api/me/profile', { nickname: '캐롤리나' })).status, 200, '내 닉네임 그대로 저장 가능');
  assert.equal((await c.call('POST', '/api/me/password', { currentPassword: 'wrong1234', newPassword: 'newpw1234' })).body.error.code, 'WRONG_PASSWORD');
  assert.equal((await c.call('POST', '/api/me/password', { currentPassword: 'carol1234', newPassword: 'short' })).status, 400);
  assert.equal((await c.call('POST', '/api/me/password', { currentPassword: 'carol1234', newPassword: 'newpw1234' })).status, 200);
  assert.equal((await c.call('GET', '/api/auth/me')).body.user.nickname, '캐롤리나', '이 기기는 로그인 유지');
  assert.equal((await other.call('GET', '/api/auth/me')).body.user, null, '다른 기기 로그아웃');
  assert.equal((await client().call('POST', '/api/auth/login', { loginId: 'carol_3', password: 'newpw1234' })).status, 200);
});

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('마이페이지: 프로필 이미지 올리기·바꾸기·삭제, 형식 검사', async () => {
  const c = client();
  await c.call('POST', '/api/auth/login', { loginId: 'carol_3', password: 'newpw1234' });
  assert.equal((await c.call('PUT', '/api/me/avatar', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400, 'SVG 거부');
  assert.equal((await c.call('PUT', '/api/me/avatar', { dataUrl: 'data:image/png;base64,' + Buffer.from('not a png').toString('base64') })).status, 400, '가짜 PNG 거부');
  const up = await c.call('PUT', '/api/me/avatar', { dataUrl: PNG_1x1 });
  assert.equal(up.status, 200);
  const url = up.body.user.avatarUrl;
  assert.match(url, /^\/avatars\/u\d+-[a-f0-9]{16}\.png$/);
  const img = await fetch(base + url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // 리뷰에도 프로필 이미지
  await c.call('PUT', '/api/games/demo-03/reviews/mine', { rating: 4 });
  assert.equal((await c.call('GET', '/api/games/demo-03/reviews')).body.reviews[0].avatarUrl, url);
  const up2 = await c.call('PUT', '/api/me/avatar', { dataUrl: PNG_1x1 });
  assert.notEqual(up2.body.user.avatarUrl, url);
  assert.equal((await fetch(base + url)).status, 404, '이전 파일 삭제');
  assert.equal((await c.call('DELETE', '/api/me/avatar')).body.user.avatarUrl, null);
  assert.equal((await fetch(base + '/avatars/..%2F..%2Fpackage.json')).status, 404);
});

test('마이페이지: 내 리뷰 내역(게임 제목 포함)·삭제, 최근 본 게임(최신순·중복 없음·삭제)', async () => {
  const c = client();
  await c.call('POST', '/api/auth/login', { loginId: 'carol_3', password: 'newpw1234' });
  const reviews = (await c.call('GET', '/api/me/reviews')).body.items;
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].title, '한 줄 퍼즐 산책');
  await c.call('DELETE', `/api/games/${reviews[0].gameId}/reviews/mine`);
  assert.equal((await c.call('GET', '/api/me/reviews')).body.items.length, 0);

  for (const id of ['demo-01', 'demo-02', 'demo-01']) {
    await c.call('GET', `/api/games/${id}`);
    await new Promise((r) => setTimeout(r, 5));
  }
  let recent = (await c.call('GET', '/api/me/recent')).body.items;
  assert.deepEqual(recent.map((x) => x.gameId).slice(0, 2), ['demo-01', 'demo-02']);
  assert.equal(recent.filter((x) => x.gameId === 'demo-01').length, 1);
  recent = (await c.call('DELETE', '/api/me/recent/demo-02')).body.items;
  assert.ok(!recent.some((x) => x.gameId === 'demo-02'));
  assert.deepEqual((await c.call('DELETE', '/api/me/recent')).body.items, []);
  // 로그인 안 하면 기록 안 됨 / 볼 수 없음
  await client().call('GET', '/api/games/demo-05');
  assert.equal((await client().call('GET', '/api/me/recent')).status, 401);
});

test('메뉴 목록 API(데모): 인기·장르·플랫폼·페이지, 출시일/글로벌 목록은 안내, 잘못된 값 400', async () => {
  const c = client();
  const pop = (await c.call('GET', '/api/browse/popular')).body;
  assert.equal(pop.games.length, 15, '데모 16개 중 아케이드 전용 1개(demo-12)는 목록에서 뺌');
  assert.ok(!pop.games.some((g) => g.id === 'demo-12'));
  assert.equal(pop.hasMore, false);
  const rpg = (await c.call('GET', '/api/browse/genre?genre=rpg')).body.games;
  assert.ok(rpg.length > 0 && rpg.every((g) => g.genres.includes('rpg')));
  const rpgPc = (await c.call('GET', '/api/browse/genre?genre=rpg&platform=pc')).body.games;
  assert.ok(rpgPc.every((g) => g.platforms.includes('pc')));
  const recent = (await c.call('GET', '/api/browse/recent')).body;
  assert.deepEqual(recent.games, []);
  assert.match(recent.warnings[0], /출시일/);
  assert.equal((await c.call('GET', '/api/browse/genre')).status, 400);
  assert.equal((await c.call('GET', '/api/browse/genre?genre=zzz')).status, 400);
  assert.equal((await c.call('GET', '/api/browse/popular?platform=zzz')).status, 400);
  assert.equal((await c.call('GET', '/api/browse/nope')).status, 404);
});

test('회원 평점 랭킹: 평균 높은 순, 같으면 평가 많은 순', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/api/auth/login', { loginId: 'bob_02', password: 'secret456' })).status, 200);
  await c.call('PUT', '/api/games/demo-08/reviews/mine', { rating: 5 });
  await c.call('PUT', '/api/games/demo-09/reviews/mine', { rating: 2 });
  const d = client();
  assert.equal((await d.call('POST', '/api/auth/login', { loginId: 'carol_3', password: 'newpw1234' })).status, 200);
  await d.call('PUT', '/api/games/demo-08/reviews/mine', { rating: 5 });
  const games = (await c.call('GET', '/api/ranking/members')).body.games;
  const ids = games.map((g) => g.id);
  assert.ok(ids.indexOf('demo-08') < ids.indexOf('demo-09'));
  const g8 = games.find((g) => g.id === 'demo-08');
  assert.deepEqual(g8.userRating, { count: 2, avg: 5 });
  assert.equal(g8.title, '주사위 왕 파티');
  assert.ok(Array.isArray(g8.platforms), '데모 게임 정보로 보강');
});
