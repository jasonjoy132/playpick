// E2E: 다른 계정으로 로그인 (가짜 Google·Discord — 제공자 화면은 Playwright가 바로 돌려보냄)
//  처음 가입(닉네임) → 원래 화면으로, 로그아웃 후 다시 버튼 한 번에 로그인, 취소 안내,
//  마이페이지 연결된 계정(연결·끊기), 비밀번호 만들기, 비밀번호 없이 탈퇴
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PROFILES = {
  'g-1': { sub: 'g-1', email: 'friend@gmail.com', email_verified: true, name: '게임친구' },
  'd-1': { id: '77', email: 'friend@gmail.com', verified: true, global_name: 'friend' },
};
const fakeFetch = async (url, opt = {}) => {
  if (/token$/.test(url)) {
    const code = new URLSearchParams(String(opt.body)).get('code');
    return new Response(JSON.stringify({ access_token: `tok-${code}` }), { status: 200 });
  }
  const code = String(opt.headers?.Authorization ?? '').replace('Bearer tok-', '');
  return new Response(JSON.stringify(PROFILES[code]), { status: 200 });
};
let server, base, browser, provider;
// 가짜 제공자 화면: 동의한 것처럼(code) 또는 취소(error) 우리 callback 으로 바로 돌려보냄
const answer = { google: 'g-1', discord: 'd-1', cancel: false };

before(async () => {
  provider = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const prov = u.pathname.slice(1);
    const q = answer.cancel ? 'error=access_denied' : `code=${answer[prov]}`;
    res.writeHead(302, { Location: `${base}/api/auth/oauth/${prov}/callback?${q}&state=${u.searchParams.get('state')}` });
    res.end();
  });
  await new Promise((r) => provider.listen(0, r));
  const fake = `http://127.0.0.1:${provider.address().port}`;
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', oauth: { google: { clientId: 'g', clientSecret: 's' }, discord: { clientId: 'd', clientSecret: 's' } } },
    { oauthFetch: fakeFetch, oauthEndpoints: { google: { authorize: `${fake}/google` }, discord: { authorize: `${fake}/discord` } } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
  provider?.close();
});

async function fakeProviders(_page, { google = 'g-1', discord = 'd-1', cancel = false } = {}) {
  Object.assign(answer, { google, discord, cancel });
}

test('Google로 처음 가입 → 닉네임 → 원래 화면, 로그아웃 후 버튼 한 번에 로그인, 취소 안내', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeProviders(page);

  // 로그인 화면: 버튼 두 개
  await page.goto(`${base}/login?next=${encodeURIComponent('/hall-of-fame')}`);
  await page.getByTestId('social-google').waitFor();
  assert.equal(await page.getByTestId('social-discord').count(), 1);
  assert.match(await page.getByTestId('social-google').getAttribute('href'), /\/api\/auth\/oauth\/google\/start\?next=%2Fhall-of-fame/);

  // 취소하면 안내
  await fakeProviders(page, { cancel: true });
  await page.getByTestId('social-google').click();
  await page.waitForURL(/oauthError=OAUTH_DENIED/);
  await page.getByText('Google 로그인을 취소했어요.').waitFor();

  // 동의 → 닉네임 정하기(이름에서 후보) → 원래 화면
  await fakeProviders(page);
  await page.getByTestId('social-google').click();
  await page.waitForURL(/\/signup\/social$/);
  await page.getByTestId('social-who').getByText('friend@gmail.com').waitFor();
  assert.equal(await page.locator('#f-nickname').inputValue(), '게임친구');
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await page.waitForURL(/\/hall-of-fame$/);

  // 마이페이지: 아이디 대신 이메일, 연결된 계정, 비밀번호 '만들기'
  await page.goto(`${base}/mypage/accounts`);
  await page.getByTestId('identity-google').getByText('friend@gmail.com', { exact: false }).waitFor();
  assert.ok(await page.getByTestId('identity-google').getByRole('button', { name: '연결 끊기' }).isDisabled()); // 하나뿐이라
  // Discord 연결
  await page.getByTestId('identity-discord').getByRole('link', { name: '연결하기' }).click();
  await page.waitForURL(/\/mypage\/accounts\?linked=discord/);
  await page.getByText('Discord 계정을 연결했어요.', { exact: false }).waitFor();
  await page.getByTestId('identity-discord').getByRole('button', { name: '연결 끊기' }).waitFor();
  // 이제 Google 끊기 가능
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('identity-google').getByRole('button', { name: '연결 끊기' }).click();
  await page.getByText('Google 계정 연결을 끊었어요.').waitFor();
  await page.getByTestId('identity-google').getByRole('link', { name: '연결하기' }).waitFor();

  // 비밀번호 만들기(현재 비밀번호 없음)
  await page.goto(`${base}/mypage/password`);
  await page.getByTestId('password-making').waitFor();
  assert.equal(await page.locator('#f-cur').count(), 0);
  await page.fill('#f-new', 'mypass123');
  await page.fill('#f-new2', 'mypass123');
  await page.getByRole('button', { name: '비밀번호 만들기' }).click();
  await page.getByText('비밀번호를 만들었어요.', { exact: false }).waitFor();

  // 로그아웃 → Discord 버튼 한 번에 로그인 (홈 로그인 창)
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'playpick' } }));
  await page.goto(base);
  await page.getByTestId('login-panel').getByTestId('social-discord').click();
  await page.getByTestId('profile-panel').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('회원가입 화면 위에 소셜 버튼, 소셜로만 가입한 회원은 비밀번호 없이 탈퇴', async () => {
  PROFILES['g-2'] = { sub: 'g-2', email: 'solo@gmail.com', email_verified: true, name: 'S' };
  const page = await browser.newPage();
  await fakeProviders(page, { google: 'g-2' });
  await page.goto(`${base}/signup`);
  await page.getByTestId('social-google').waitFor();
  await page.getByText('또는 아이디로 가입').waitFor();
  await page.getByTestId('social-google').click();
  await page.waitForURL(/\/signup\/social$/);
  assert.equal(await page.locator('#f-nickname').inputValue(), ''); // 한 글자 이름 → 후보 없음
  assert.ok(await page.getByRole('button', { name: '가입하고 시작하기' }).isDisabled());
  await page.fill('#f-nickname', '혼자놀이');
  await page.getByRole('button', { name: '가입하고 시작하기' }).click();
  await page.waitForURL(`${base}/`);

  await page.goto(`${base}/mypage/delete`);
  await page.getByTestId('withdraw').waitFor();
  assert.equal(await page.locator('#w-pw').count(), 0);
  await page.fill('#w-confirm', '탈퇴');
  await page.getByTestId('confirm-withdraw').click();
  await page.waitForURL(`${base}/`);
  assert.equal((await page.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))).user, null);
  await page.close();
});
