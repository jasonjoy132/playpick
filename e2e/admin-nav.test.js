// E2E 관리자: 제보 관리·성과 분석 화면 분리, 제보 종류를 바꿔도 흰 화면이 되지 않음(이전 목록을 새 카드 모양으로 그리던 오류)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let server, base, browser, boss;
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick' };
const signup = async (id, email) =>
  (await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: H, body: JSON.stringify({ loginId: id, password: 'secret123', nickname: id, email }) })).headers.get('set-cookie').split(';')[0];

before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', adminEmails: ['boss@example.com'] }, { mailer: { configured: false, devLog: false, send: async () => {} } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  boss = await signup('boss', 'boss@example.com');
  await server.db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run('boss@example.com');
  const user = await signup('user1', 'u1@example.com');
  await fetch(`${base}/api/submissions`, { method: 'POST', headers: { ...H, Cookie: user }, body: JSON.stringify({ title: '제보 게임', platforms: ['pc'], genres: ['puzzle'], playersMin: 2, playersMax: 4 }) });
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('제보 종류를 빠르게 바꿔도 흰 화면 없음, 제보 관리 ↔ 성과 분석은 따로 된 화면', async () => {
  const errors = [];
  const ctx = await browser.newContext({ locale: 'ko-KR' });
  const [name, ...rest] = boss.split('=');
  await ctx.addCookies([{ name, value: rest.join('='), url: base }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/admin`);
  await page.getByTestId('admin-card').first().waitFor();

  for (const k of ['reviews', 'photos', 'fix', 'games', 'ended', 'reviews']) {
    await page.getByTestId(`admin-kind-${k}`).click();
    await page.getByRole('heading', { name: '제보 관리' }).waitFor();
  }
  assert.equal(await page.getByTestId('admin-kind-metrics').count(), 0, '성과는 제보 종류에서 빠짐');

  await page.getByTestId('admin-nav-metrics').click();
  await page.waitForURL(`${base}/admin/metrics`);
  await page.getByTestId('metrics').waitFor();
  assert.equal(await page.getByTestId('admin-nav-metrics').getAttribute('aria-current'), 'page');
  await page.getByTestId('admin-nav-reports').click();
  await page.waitForURL(`${base}/admin`);
  await page.getByRole('heading', { name: '제보 관리' }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});
