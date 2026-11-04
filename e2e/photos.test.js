// E2E: 사진 없는 게임 상세 → 표지 사진 제보 → 관리자 '표지 사진 제보' 탭에서 승인 → 상세 표지·크레딧, 사진 칭호
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const GAME = { id: 'grac-PH1', title: '사진 없는 국내 게임', source: '게임물관리위원회', platforms: ['mobile'], genres: ['rpg'], players: null, stores: [], imageUrl: null, publisher: '테스트사' };
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => (id === GAME.id ? GAME : null),
  async browse() {
    return { games: [], hasMore: false };
  },
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base, browser;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['admin@example.com'] }, { catalog, partySize });
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

test('표지 사진 제보 → 관리자 승인 → 상세 표지, 사진 칭호', async () => {
  const errors = [];
  const user = await signedIn({ loginId: 'e2e_photo', password: 'secret123', nickname: '찍사', email: 'ph@example.com' });
  user.on('pageerror', (e) => errors.push(e.message));
  await user.goto(`${base}/games/${GAME.id}`);
  await user.getByTestId('open-image-submit').waitFor();
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/photo-btn.png` });
  await user.getByTestId('open-image-submit').click();
  const box = user.getByTestId('image-submit');
  await box.waitFor();
  await user.getByTestId('image-input').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
  await box.locator('img.cover-preview').waitFor();
  await user.fill('#photo-src', 'https://example.com/official-page');
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/photo-submit.png`, fullPage: true });
  await user.getByTestId('submit-image').click();
  await user.getByTestId('image-submit-done').waitFor();

  await user.goto(`${base}/mypage/submissions`);
  await user.getByTestId('image-submission-row').waitFor();
  assert.match(await user.getByTestId('my-image-submissions').innerText(), /사진 없는 국내 게임[\s\S]*검토 중/);

  const admin = await signedIn({ loginId: 'e2e_admin2', password: 'secret123', nickname: '운영자', email: 'admin@example.com' });
  admin.on('pageerror', (e) => errors.push(e.message));
  await admin.goto(`${base}/admin`);
  await admin.getByTestId('admin-kind-photos').click();
  const card = admin.getByTestId('admin-photo-card').first();
  await card.waitFor();
  assert.match(await card.innerText(), /사진 없는 국내 게임[\s\S]*찍사[\s\S]*example\.com\/official-page/);
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/admin-photos.png`, fullPage: true });
  await card.getByTestId('approve-photo').click();
  await admin.getByTestId('admin-tab-approved').click();
  await admin.getByTestId('admin-photo-card').first().waitFor();

  await user.goto(`${base}/games/${GAME.id}`);
  const toast = user.getByTestId('badge-toast');
  await toast.waitFor();
  assert.match(await toast.innerText(), /스냅샷/);
  await user.getByTestId('badge-toast-equip').click();
  const credit = user.getByTestId('image-credit');
  await credit.waitFor();
  assert.match(await credit.innerText(), /사용자 제보[\s\S]*찍사[\s\S]*출처/);
  assert.equal(await user.getByTestId('open-image-submit').count(), 0, '사진이 생기면 제보 버튼 없음');
  assert.match(await user.locator('.detail-cover img').first().getAttribute('src'), /^\/submission-images\/p\d+-/);
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/photo-detail.png` });

  await user.goto(`${base}/mypage/badges`);
  await user.getByTestId('badge-ph1').waitFor();
  assert.match(await user.getByTestId('badge-ph1').getAttribute('class'), /is-earned/);
  assert.match(await user.getByTestId('next-photo').innerText(), /4개/);
  if (SHOTS) await user.getByTestId('badge-ph1').screenshot({ path: `${SHOTS}/badge-ph-row.png` }).catch(() => {});
  if (SHOTS) await user.locator('.badge-grid').nth(2).screenshot({ path: `${SHOTS}/badge-ph-grid.png` });
  assert.deepEqual(errors, []);
});
