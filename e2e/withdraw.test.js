// E2E: 마이페이지 → 회원 탈퇴 → 비밀번호·'탈퇴' 입력해야 버튼이 켜짐 → 탈퇴 → 홈, 로그아웃 상태, 안내 문구
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let server, base, browser;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

for (const viewport of [{ width: 1200, height: 900 }, { width: 375, height: 760 }]) {
  test(`회원 탈퇴 흐름 (${viewport.width}px)`, async () => {
    const errors = [];
    const page = await (await browser.newContext({ locale: 'ko-KR', viewport })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const id = `e2e_bye${viewport.width}`;
    const r = await page.request.post(`${base}/api/auth/signup`, {
      data: { loginId: id, password: 'secret123', nickname: `탈퇴${viewport.width}`, email: `${id}@example.com` },
      headers: { 'X-Requested-With': 'playpick' },
    });
    assert.equal(r.status(), 201);

    await page.goto(`${base}/mypage/delete`);
    const box = page.getByTestId('withdraw');
    await box.waitFor();
    assert.match(await box.innerText(), /되돌릴 수 없어요[\s\S]*바로 지워져요[\s\S]*작성자 없이 남아요/);
    const btn = page.getByTestId('confirm-withdraw');
    assert.equal(await btn.isDisabled(), true, '처음엔 꺼짐');
    await page.getByLabel('비밀번호').fill('wrong999');
    assert.equal(await btn.isDisabled(), true, "'탈퇴' 입력 전엔 꺼짐");
    await page.getByLabel(/탈퇴라고 입력/).fill('탈퇴');
    assert.equal(await btn.isDisabled(), false);
    await btn.click();
    assert.match(await page.getByRole('alert').innerText(), /비밀번호가 올바르지 않습니다/);

    await page.getByLabel('비밀번호').fill('secret123');
    await btn.click();
    await page.waitForURL(`${base}/`);
    await page.getByTestId('bye-notice').waitFor();
    await page.getByTestId('header-login').waitFor();
    assert.equal(await page.getByTestId('notif-bell').count(), 0);
    if (viewport.width < 400) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '가로 스크롤 없음');

    // 새로 고치면 안내는 사라짐, 같은 아이디로 로그인 안 됨
    await page.reload();
    await page.getByTestId('header-login').waitFor();
    assert.equal(await page.getByTestId('bye-notice').count(), 0);
    const login = await page.request.post(`${base}/api/auth/login`, { data: { loginId: id, password: 'secret123' }, headers: { 'X-Requested-With': 'playpick' } });
    assert.equal(login.status(), 401);
    assert.deepEqual(errors, []);
  });
}
