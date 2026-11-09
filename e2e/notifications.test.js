// E2E: 게임 제보 → 관리자 거절 → 헤더 알림 종에 숫자 → 열어서 사유 확인 → 누르면 '내 제보'로, 읽음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

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

async function signedIn(account, viewport = { width: 1200, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport });
  const page = await ctx.newPage();
  const r = await page.request.post(`${base}/api/auth/signup`, { data: account, headers: { 'X-Requested-With': 'playpick' } });
  assert.equal(r.status(), 201);
  return page;
}
const H = { 'X-Requested-With': 'playpick' };

test('제보 거절 알림: 종 숫자 → 패널 → 내 제보로 이동, 읽음', async () => {
  const errors = [];
  const user = await signedIn({ loginId: 'e2e_bell', password: 'secret123', nickname: '종소리', email: 'bell@example.com' });
  user.on('pageerror', (e) => errors.push(e.message));
  const admin = await signedIn({ loginId: 'e2e_admin', password: 'secret123', nickname: '관리자', email: 'admin@example.com' });

  // 로그인 안 하면 종이 없음
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(base);
  await anon.getByTestId('header-login').waitFor();
  assert.equal(await anon.getByTestId('notif-bell').count(), 0);

  // 가입 환영 알림 1개
  await user.goto(base);
  await user.getByTestId('notif-bell').waitFor();
  assert.equal(await user.getByTestId('notif-count').innerText(), '1');

  const s = await user.request.post(`${base}/api/submissions`, { data: { title: '종 테스트 게임', platforms: ['pc'], genres: ['puzzle'] }, headers: H });
  const { item } = await s.json();
  // 관리자 종: 검토 대기 줄
  await admin.goto(base);
  await admin.getByTestId('notif-bell').click();
  assert.match(await admin.getByTestId('notif-pending').innerText(), /검토 대기 1건/);
  const r = await admin.request.post(`${base}/api/admin/submissions/${item.id}/reject`, { data: { reason: '이미 있는 게임이에요' }, headers: H });
  assert.equal(r.status(), 200);

  // 화면을 옮기면 숫자를 다시 받음
  await user.getByRole('link', { name: '인기 게임' }).first().click();
  await user.waitForFunction(() => document.querySelector('[data-testid="notif-count"]')?.textContent === '2');
  await user.getByTestId('notif-bell').click();
  const panel = user.getByTestId('notif-panel');
  await panel.waitFor();
  const first = panel.getByTestId('notif-item').first();
  assert.match(await first.innerText(), /‘종 테스트 게임’ 게임 제보가 거절됐어요[\s\S]*사유: 이미 있는 게임이에요/);
  assert.match(await first.getAttribute('class'), /is-unread/);
  await first.click();
  await user.waitForURL(/\/mypage\/submissions$/);
  await user.getByTestId('submission-row').waitFor();
  assert.match(await user.getByTestId('my-submissions').innerText(), /거절 사유\s*이미 있는 게임이에요/);
  assert.equal(await user.getByTestId('notif-count').innerText(), '1', '누른 알림만 읽음');

  // '거절' 요약 카드로 거르기
  assert.equal(await user.getByTestId('sub-stat-rejected').locator('b').innerText(), '1');
  await user.getByTestId('sub-stat-approved').click();
  await user.getByTestId('submissions-filter-empty').waitFor();
  await user.getByTestId('sub-stat-approved').click();
  await user.getByTestId('submission-row').waitFor();

  // 모두 읽음 → 숫자 사라짐, Esc로 닫힘
  await user.getByTestId('notif-bell').click();
  await user.getByTestId('notif-read-all').click();
  await user.getByTestId('notif-count').waitFor({ state: 'detached' });
  await user.keyboard.press('Escape');
  await user.getByTestId('notif-panel').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});

test('모바일 폭: 알림 패널이 화면 안에 들어옴', async () => {
  const page = await signedIn({ loginId: 'e2e_bell_m', password: 'secret123', nickname: '모바일종', email: 'bellm@example.com' }, { width: 375, height: 760 });
  await page.goto(base);
  await page.getByTestId('notif-bell').click();
  const box = await page.getByTestId('notif-panel').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 375, `패널이 화면 안 (${box.x}, ${box.width})`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '가로 스크롤 없음');
});
