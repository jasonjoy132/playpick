// E2E: 받은 칭호 중 골라 대표 칭호로 (마이페이지 · 홈 프로필 패널)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

let server, base, browser;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', adminEmails: ['admin@example.com'] });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('대표 칭호 고르기: 받은 칭호만, 고르면 닉네임 앞 뱃지가 바뀜, 자동으로 되돌리기', async () => {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const h = { 'X-Requested-With': 'playpick' };
  assert.equal((await page.request.post(`${base}/api/auth/signup`, { data: { loginId: 'e2e_pick', password: 'secret123', nickname: '고르미', email: 'pick@example.com' }, headers: h })).status(), 201);
  // 관리자 계정으로 정보 수정 제보(바로 승인) → 정보 지킴이, 리뷰 1개 → 새내기 리뷰어
  const games = (await (await page.request.get(`${base}/api/featured`)).json()).games;
  const gid = games[0].id;
  await page.request.put(`${base}/api/games/${gid}/reviews/mine`, { data: { rating: 5, content: '좋아요' }, headers: h });
  await page.goto(`${base}/mypage/badges`);
  const picker = page.getByTestId('badge-picker');
  await picker.waitFor();
  assert.equal(await picker.getByTestId('pick-rv1').count(), 1, '받은 칭호만');
  assert.equal(await picker.getByTestId('pick-if1').count(), 0, '못 받은 칭호는 없음');
  assert.equal(await picker.getByTestId('pick-auto').getAttribute('aria-checked'), 'true');
  await picker.getByTestId('pick-rv1').click();
  await page.getByTestId('badge-picker').getByTestId('pick-rv1').and(page.locator('[aria-checked="true"]')).waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/badge-picker.png`, fullPage: true });
  const me = await (await page.request.get(`${base}/api/me/badges`)).json();
  assert.equal(me.selected, 'rv1');

  // 홈 프로필 패널에서도 고르기
  await page.goto(base);
  await page.getByTestId('pp-pick-toggle').click();
  await page.getByTestId('profile-panel').getByTestId('pick-auto').click();
  await page.getByTestId('profile-panel').getByTestId('pick-auto').and(page.locator('[aria-checked="true"]')).waitFor();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pp-picker.png` });
  assert.equal((await (await page.request.get(`${base}/api/me/badges`)).json()).selected, null);
  assert.deepEqual(errors, []);
});
