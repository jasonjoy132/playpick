// E2E: 회원 게임 제보 → 관리자 승인 → 검색·상세에 나옴, 내 제보에 상태 표시
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
// 1x1 PNG (테스트용)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

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

async function signedIn(account) {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const r = await page.request.post(`${base}/api/auth/signup`, { data: account, headers: { 'X-Requested-With': 'playpick' } });
  assert.equal(r.status(), 201);
  return page;
}

test('게임 제보 → 관리자 승인 → 검색·상세, 내 제보 상태', async () => {
  const errors = [];
  const user = await signedIn({ loginId: 'e2e_reporter', password: 'secret123', nickname: '제보왕', email: 'rep@example.com' });
  user.on('pageerror', (e) => errors.push(e.message));

  // 메뉴에 '게임 제보'는 있고 '제보 관리'는 없음
  await user.goto(base);
  await user.getByTestId('user-menu').click();
  await user.getByTestId('menu-submit').waitFor();
  assert.equal(await user.getByTestId('menu-admin').count(), 0);
  await user.getByTestId('menu-submit').click();

  const form = user.getByTestId('submit-form');
  await form.waitFor();
  await user.fill('#s-title', '던전');
  await user.getByTestId('similar').waitFor(); // 데모의 '던전 동맹'이 비슷한 게임으로 보임
  await user.fill('#s-title', '이투이 테스트 협동 게임');
  await user.fill('#s-orig', 'E2E Coop Test');
  await form.locator('label.chip', { hasText: 'PC' }).click();
  await form.locator('label.chip', { hasText: '퍼즐' }).click();
  await user.getByLabel('최소 인원').fill('2');
  await user.getByLabel('최대 인원').fill('4');
  await user.fill('#s-store', 'https://evil.example.com/game');
  await user.getByTestId('submit-game').click();
  assert.match(await user.locator('.form-error').innerText(), /공식 스토어/);
  await user.fill('#s-store', 'https://store.steampowered.com/app/999999/');
  await user.fill('#s-summary', '둘이서 함께 푸는 협동 퍼즐');
  await user.getByTestId('cover-input').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await user.locator('img.cover-preview').waitFor();
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/submit-form.png`, fullPage: true });
  await user.getByTestId('submit-game').click();
  await user.getByTestId('submit-done').waitFor();

  await user.goto(`${base}/mypage/submissions`);
  await user.getByTestId('submission-row').first().waitFor();
  assert.match(await user.getByTestId('my-submissions').innerText(), /검토 중[\s\S]*이투이 테스트 협동 게임/);

  // 관리자 승인
  const admin = await signedIn({ loginId: 'e2e_admin', password: 'secret123', nickname: '운영자', email: 'admin@example.com' });
  admin.on('pageerror', (e) => errors.push(e.message));
  await admin.goto(base);
  await admin.getByTestId('user-menu').click();
  await admin.getByTestId('menu-admin').click();
  const card = admin.getByTestId('admin-card').first();
  await card.waitFor();
  assert.match(await card.innerText(), /제보왕[\s\S]*PC[\s\S]*퍼즐[\s\S]*2~4명/);
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/admin.png`, fullPage: true });
  await card.getByTestId('approve').click();
  await admin.getByTestId('admin-tab-approved').click();
  await admin.getByTestId('admin-card').first().waitFor();

  // 새 칭호 알림 (페이지를 새로 열면 내 정보를 다시 받아 알림)
  await user.goto(`${base}/search?q=${encodeURIComponent('테스트 협동')}`);
  const toast = user.getByTestId('badge-toast');
  await toast.waitFor();
  assert.match(await toast.innerText(), /새 칭호를 얻었어요[\s\S]*첫 발견자/);
  if (SHOTS) {
    await user.waitForTimeout(1300);
    await user.screenshot({ path: `${SHOTS}/badge-toast.png` });
  }
  await user.getByTestId('badge-toast-equip').click();
  await toast.waitFor({ state: 'detached' });
  await user.reload();
  await user.getByTestId('game-card').first().waitFor();
  assert.equal(await user.getByTestId('badge-toast').count(), 0, '확인한 칭호는 다시 알리지 않음');

  // 검색 → 상세
  const tile = user.getByTestId('game-card').first();
  await tile.waitFor();
  assert.match(await tile.innerText(), /제보[\s\S]*이투이 테스트 협동 게임/);
  await tile.locator('a.stretched-link').click();
  await user.getByTestId('game-detail').waitFor();
  const detail = await user.getByTestId('game-detail').innerText();
  assert.match(detail, /추천 인원\s*2~4명/);
  assert.match(detail, /제보자\s*제보왕/);
  assert.doesNotMatch(detail, /첫 발견자/, '칭호 이름은 보이지 않고 그림만');
  const nb = user.getByTestId('submitter').getByTestId('name-badge');
  await nb.waitFor();
  assert.equal(await nb.getAttribute('title'), '첫 발견자', '마우스를 올리면 칭호 이름');
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/detail-badge.png`, fullPage: true });

  // 뱃지·칭호 화면: 첫 발견자 받음, 다음 목표 안내
  await user.goto(`${base}/mypage/badges`);
  await user.getByTestId('badge-finder').waitFor();
  assert.match(await user.getByTestId('badge-finder').getAttribute('class'), /is-earned/);
  assert.doesNotMatch(await user.getByTestId('badge-digger').getAttribute('class'), /is-earned/);
  assert.match(await user.locator('.badge-hero').innerText(), /승인 2개 더/);
  assert.match(await user.getByTestId('next-review').innerText(), /리뷰 1개 더/);
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/badges.png`, fullPage: true });

  await user.goto(`${base}/mypage/submissions`);
  await user.getByTestId('submission-row').first().waitFor();
  assert.match(await user.getByTestId('my-submissions').innerText(), /승인됨/);

  // 일반 회원이 /admin 에 직접 가면 막힘
  await user.goto(`${base}/admin`);
  await user.getByText('관리자만 볼 수 있어요').waitFor();
  assert.deepEqual(errors, []);
});
