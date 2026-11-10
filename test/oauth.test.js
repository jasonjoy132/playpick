// 다른 계정으로 로그인(Google·Discord): state 확인, 처음 가입(닉네임), 다시 로그인, 같은 이메일 연결(인증된 것만),
// 연결·끊기, 소셜 전용 계정의 비밀번호 만들기·탈퇴·아이디 찾기 메일, 키가 없으면 버튼 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

// 가짜 제공자: code → 프로필
const PROFILES = {
  'g-new': { sub: 'g-100', email: 'New@Gmail.com', email_verified: true, name: 'Kim Play' },
  'g-unverified': { sub: 'g-200', email: 'nov@gmail.com', email_verified: false, name: 'Nov' },
  'g-member': { sub: 'g-300', email: 'member@example.com', email_verified: true, name: 'Member' },
  'd-new': { id: '900', email: 'new@gmail.com', verified: true, global_name: '디코친구' },
  'd-other': { id: '901', email: 'other@x.com', verified: true, username: 'other' },
};
const calls = [];
const fakeFetch = async (url, opt = {}) => {
  calls.push(String(url));
  if (/token$/.test(url)) {
    const code = new URLSearchParams(String(opt.body)).get('code');
    if (!PROFILES[code]) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: `tok-${code}` }), { status: 200 });
  }
  const code = String(opt.headers?.Authorization ?? '').replace('Bearer tok-', '');
  return new Response(JSON.stringify(PROFILES[code]), { status: 200 });
};
const mails = [];
let server, base;

before(async () => {
  server = createApp(
    {
      ...getConfig(),
      dataSource: 'demo',
      dbFile: ':memory:',
      baseUrl: 'http://localhost:4000',
      adminEmails: ['member@example.com'],
      oauth: { google: { clientId: 'gid', clientSecret: 'gsecret' }, discord: { clientId: 'did', clientSecret: 'dsecret' } },
    },
    { oauthFetch: fakeFetch, mailer: { configured: true, devLog: false, send: async (m) => mails.push(m) } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** 쿠키를 기억하는 브라우저 흉내 */
function browser() {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (v === '' || /Max-Age=0/.test(c)) delete jar[k];
      else jar[k] = v;
    }
  };
  const go = async (p) => {
    const res = await fetch(base + p, { redirect: 'manual', headers: { Cookie: cookieHeader() } });
    keep(res);
    return res;
  };
  const api = async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', Cookie: cookieHeader() },
      body: body ? JSON.stringify(body) : undefined,
    });
    keep(res);
    return { status: res.status, body: await res.json() };
  };
  /** 버튼 누르기 → 제공자 화면 주소 확인 → 그 code 로 돌아오기. 돌아온 뒤 이동한 주소를 돌려줌 */
  const social = async (prov, code, { next, mode, state } = {}) => {
    const qs = new URLSearchParams({ ...(next ? { next } : {}), ...(mode ? { mode } : {}) });
    const start = await go(`/api/auth/oauth/${prov}/start?${qs}`);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    const st = state ?? to.searchParams.get('state');
    const cb = await go(`/api/auth/oauth/${prov}/callback?code=${code}&state=${encodeURIComponent(st)}`);
    assert.equal(cb.status, 302);
    return { to, location: cb.headers.get('location') };
  };
  return { go, api, social, jar };
}

test('제공자 목록과 시작 주소: 돌아올 주소·state·scope, 키는 주소에만(Secret 없음)', async () => {
  const b = browser();
  assert.deepEqual((await b.api('GET', '/api/auth/providers')).body.providers, ['google', 'discord']);
  const res = await b.go('/api/auth/oauth/google/start?next=/game/igdb-1');
  const to = new URL(res.headers.get('location'));
  assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(to.searchParams.get('redirect_uri'), 'http://localhost:4000/api/auth/oauth/google/callback');
  assert.equal(to.searchParams.get('client_id'), 'gid');
  assert.equal(to.searchParams.get('scope'), 'openid email profile');
  assert.ok(to.searchParams.get('state').length >= 16);
  assert.ok(!res.headers.get('location').includes('gsecret'));
  const set = res.headers.getSetCookie().join(';');
  assert.match(set, /pp_oauth=.*HttpOnly/);
  assert.match(set, /Path=\/api\/auth\/oauth/);
});

test('state 가 다르거나 쿠키가 없으면 로그인 안 됨, 취소하면 안내', async () => {
  const b = browser();
  const { location } = await b.social('google', 'g-new', { state: 'forged', next: '/x' });
  assert.match(location, /^\/login\?oauthError=OAUTH_STATE&provider=google&next=%2Fx/);
  assert.equal(b.jar.pp_session, undefined);
  // 쿠키 없이 바로 callback
  const c = browser();
  const r = await c.go('/api/auth/oauth/google/callback?code=g-new&state=abc');
  assert.match(r.headers.get('location'), /oauthError=OAUTH_STATE/);
  // 제공자 화면에서 취소
  await c.go('/api/auth/oauth/discord/start');
  const r2 = await c.go('/api/auth/oauth/discord/callback?error=access_denied&state=x');
  assert.match(r2.headers.get('location'), /oauthError=OAUTH_DENIED&provider=discord/);
});

test('인증 안 된 이메일은 가입·연결 안 됨', async () => {
  const b = browser();
  const { location } = await b.social('google', 'g-unverified');
  assert.match(location, /oauthError=OAUTH_EMAIL_UNVERIFIED/);
  assert.equal(b.jar.pp_session, undefined);
});

test('처음 온 Google 계정: 닉네임 정하기 → 가입, 다시 오면 바로 로그인, 아이디·비밀번호 로그인은 안 됨', async () => {
  const b = browser();
  const { location } = await b.social('google', 'g-new', { next: '/game/igdb-7' });
  assert.equal(location, '/signup/social');
  assert.equal(b.jar.pp_session, undefined);
  const pend = (await b.api('GET', '/api/auth/oauth/pending')).body.pending;
  assert.equal(pend.provider, 'google');
  assert.equal(pend.email, 'new@gmail.com');
  assert.equal(pend.nickname, 'KimPlay'); // 이름에서 규칙에 맞게 다듬은 후보
  assert.equal(pend.next, '/game/igdb-7');
  // 닉네임 규칙
  assert.equal((await b.api('POST', '/api/auth/oauth/complete', { nickname: '!' })).status, 400);
  const done = await b.api('POST', '/api/auth/oauth/complete', { nickname: '플레이어1' });
  assert.equal(done.status, 201);
  assert.equal(done.body.next, '/game/igdb-7');
  assert.equal(done.body.user.nickname, '플레이어1');
  assert.equal(done.body.user.hasPassword, false);
  assert.match(done.body.user.loginId, /^g_[0-9a-f]{10}$/);
  assert.ok(b.jar.pp_session);
  // 대기 정보는 한 번만
  assert.equal((await b.api('GET', '/api/auth/oauth/pending')).body.pending, null);
  assert.equal((await b.api('POST', '/api/auth/oauth/complete', { nickname: '다른닉' })).status, 400);
  const ids = (await b.api('GET', '/api/me/identities')).body;
  assert.deepEqual(ids.items.map((x) => x.provider), ['google']);
  assert.equal(ids.hasPassword, false);
  // 마지막 로그인 방법은 끊을 수 없음
  assert.equal((await b.api('DELETE', '/api/me/identities/google')).body.error.code, 'LAST_LOGIN_METHOD');

  // 다른 브라우저에서 같은 Google 계정 → 바로 로그인
  const c = browser();
  const again = await c.social('google', 'g-new', { next: '/mypage' });
  assert.equal(again.location, '/mypage');
  assert.equal((await c.api('GET', '/api/auth/me')).body.user.nickname, '플레이어1');
  // 비밀번호가 없으니 아이디로는 로그인 안 됨
  const login = await c.api('POST', '/api/auth/login', { loginId: done.body.user.loginId, password: '' });
  assert.equal(login.status, 401);

  // Discord(같은 인증 이메일) → 같은 회원에 연결
  const d = browser();
  const dl = await d.social('discord', 'd-new');
  assert.equal(dl.location, '/');
  assert.equal((await d.api('GET', '/api/auth/me')).body.user.nickname, '플레이어1');
  assert.deepEqual((await d.api('GET', '/api/me/identities')).body.items.map((x) => x.provider).sort(), ['discord', 'google']);
  // 이제 하나를 끊을 수 있음
  assert.deepEqual((await d.api('DELETE', '/api/me/identities/discord')).body.items.map((x) => x.provider), ['google']);

  // 아이디 찾기 메일: 아이디 대신 Google 로그인 안내
  mails.length = 0;
  await d.api('POST', '/api/auth/find-id', { email: 'new@gmail.com' });
  assert.equal(mails.length, 1);
  assert.match(mails[0].lines.join(' '), /Google 계정으로 가입/);
  assert.ok(!mails[0].lines.join(' ').includes(done.body.user.loginId));

  // 비밀번호 만들기(현재 비밀번호 없이) → 아이디 로그인 가능
  assert.equal((await d.api('POST', '/api/me/password', { newPassword: 'newpass12' })).status, 200);
  const e = browser();
  assert.equal((await e.api('POST', '/api/auth/login', { loginId: done.body.user.loginId, password: 'newpass12' })).status, 200);
  // 이제는 현재 비밀번호가 필요함
  assert.equal((await e.api('POST', '/api/me/password', { newPassword: 'another12' })).status, 400);
});

test('아이디로 가입한 회원: 같은 인증 이메일이면 Google 연결, 관리자도 그대로', async () => {
  const b = browser();
  const s = await b.api('POST', '/api/auth/signup', { loginId: 'member1', password: 'pass1234', nickname: '회원1', email: 'member@example.com' });
  assert.equal(s.status, 201);
  const c = browser();
  const { location } = await c.social('google', 'g-member', { next: '/admin' });
  assert.equal(location, '/admin');
  const me = (await c.api('GET', '/api/auth/me')).body.user;
  assert.equal(me.loginId, 'member1');
  assert.equal(me.isAdmin, true);
  assert.equal(me.hasPassword, true);
});

test('로그인한 회원이 다른 계정 연결: 다른 회원의 계정은 안 됨, 로그인 안 하면 로그인 화면으로', async () => {
  const b = browser();
  await b.api('POST', '/api/auth/signup', { loginId: 'linker1', password: 'pass1234', nickname: '연결러', email: 'linker@example.com' });
  const ok = await b.social('discord', 'd-other', { mode: 'link' });
  assert.equal(ok.location, '/mypage/accounts?linked=discord');
  assert.deepEqual((await b.api('GET', '/api/me/identities')).body.items.map((x) => [x.provider, x.email]), [['discord', 'other@x.com']]);
  // 이미 '플레이어1'에 연결된 Google 계정
  const taken = await b.social('google', 'g-new', { mode: 'link' });
  assert.match(taken.location, /^\/mypage\/accounts\?oauthError=OAUTH_TAKEN&provider=google/);
  // 로그인 안 한 채 연결 시작
  const c = browser();
  const r = await c.go('/api/auth/oauth/google/start?mode=link');
  assert.equal(r.headers.get('location'), '/login?next=%2Fmypage%2Faccounts');
});

test('소셜로만 가입한 회원 탈퇴: 비밀번호 없이 탈퇴 입력만, 연결도 지워져 다시 오면 새 가입', async () => {
  const b = browser();
  await b.social('discord', 'd-other'); // 위에서 linker1 에 연결됨 → 로그인
  assert.equal((await b.api('GET', '/api/auth/me')).body.user.nickname, '연결러');
  const fresh = browser();
  PROFILES['g-solo'] = { sub: 'g-777', email: 'solo@gmail.com', email_verified: true, name: 'S' };
  assert.equal((await fresh.social('google', 'g-solo')).location, '/signup/social');
  assert.equal((await fresh.api('GET', '/api/auth/oauth/pending')).body.pending.nickname, ''); // 한 글자 이름은 후보 없음
  assert.equal((await fresh.api('POST', '/api/auth/oauth/complete', { nickname: '혼자' })).status, 201);
  assert.equal((await fresh.api('POST', '/api/me/delete', { confirm: '탈퇴' })).status, 200);
  const again = browser();
  assert.equal((await again.social('google', 'g-solo')).location, '/signup/social');
});

test('키가 없으면 버튼 목록이 비고, 시작해도 로그인 화면으로 돌아감', async () => {
  const s2 = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', oauth: {} });
  await new Promise((r) => s2.listen(0, r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    assert.deepEqual((await (await fetch(`${b2}/api/auth/providers`)).json()).providers, []);
    const r = await fetch(`${b2}/api/auth/oauth/google/start`, { redirect: 'manual' });
    assert.match(r.headers.get('location'), /^\/login\?next=%2F&oauthError=OAUTH_DISABLED/);
  } finally {
    s2.close();
  }
});
