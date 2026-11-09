// E2E: 상세 '정보가 틀렸나요?' → 서비스 종료·정보 수정 제보, 리뷰 신고 → 관리자 처리 → 화면 반영
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const GAMES = {
  'igdb-81': { id: 'igdb-81', title: '종료될 온라인 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: { min: 1, max: 8 }, recommendedPlayers: null, stores: [], imageUrl: null, altNames: [] },
  'igdb-82': { id: 'igdb-82', title: '정보 고칠 게임', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: { min: 1, max: 8 }, recommendedPlayers: null, stores: [], imageUrl: null, altNames: [] },
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  browse: async () => ({ games: Object.values(GAMES), hasMore: false }),
  search: async () => ({ games: Object.values(GAMES), warnings: [] }),
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

test('서비스 종료·정보 수정 제보, 리뷰 신고 → 관리자 처리 → 반영', async () => {
  const errors = [];
  const user = await signedIn({ loginId: 'e2e_rep', password: 'secret123', nickname: '알림이', email: 'rep2@example.com' });
  const writer = await signedIn({ loginId: 'e2e_wr', password: 'secret123', nickname: '광고왕', email: 'wr@example.com' });
  const admin = await signedIn({ loginId: 'e2e_adm', password: 'secret123', nickname: '운영자', email: 'admin@example.com' });
  for (const p of [user, writer, admin]) p.on('pageerror', (e) => errors.push(e.message));

  // 서비스 종료 제보
  await user.goto(`${base}/games/igdb-81`);
  await user.getByTestId('open-report-ended').click();
  await user.getByTestId('report-form-ended').locator('input[type="url"]').fill('https://notice.example.com/end');
  await user.getByTestId('report-form-ended').locator('textarea').fill('2025년 서비스 종료 공지');
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/report-ended.png`, fullPage: true });
  await user.getByTestId('submit-report').click();
  await user.getByTestId('report-done').waitFor();

  // 정보 수정 제보
  await user.goto(`${base}/games/igdb-82`);
  await user.getByTestId('open-report-fix').click();
  const fix = user.getByTestId('report-form-fix');
  await fix.getByLabel('추천 인원 최소').fill('2');
  await fix.getByLabel('추천 인원 최대').fill('4');
  await fix.getByLabel('메인 스토리 플레이 시간(시간)').fill('30');
  await user.getByTestId('submit-report').click();
  await user.getByTestId('report-done').waitFor();
  await user.goto(`${base}/mypage/submissions`);
  await user.getByTestId('report-row').first().waitFor();
  assert.match(await user.getByTestId('my-submissions').innerText(), /정보 수정[\s\S]*추천 인원 2~4명 · 플레이 시간 30시간[\s\S]*서비스 종료/);
  // 종류로 거르기: 서비스 종료만
  await user.getByTestId('sub-type-ended').click();
  assert.equal(await user.getByTestId('report-row').count(), 1);
  assert.doesNotMatch(await user.getByTestId('my-submissions').innerText(), /정보 수정/);
  await user.getByTestId('sub-type-all').click();

  // 리뷰 신고
  await writer.goto(`${base}/games/igdb-82`);
  await writer.getByTestId('write-review').click();
  await writer.locator('.stars-input label').nth(0).click();
  await writer.fill('#review-text', '여기 말고 우리 사이트 오세요 http://spam.example');
  await writer.getByTestId('review-form').locator('button[type="submit"]').click();
  await writer.getByTestId('review-item').first().waitFor();
  await user.goto(`${base}/games/igdb-82`);
  await user.getByTestId('report-review').click();
  await user.getByTestId('report-review-form').locator('label.chip', { hasText: '광고·도배' }).click();
  await user.getByTestId('submit-review-report').click();
  await user.getByTestId('review-reported').waitFor();

  // 관리자: 종료 승인, 정보 수정 승인, 리뷰 숨김
  await admin.goto(`${base}/admin`);
  await admin.getByTestId('admin-kind-ended').click();
  const ended = admin.getByTestId('admin-report-card').first();
  await ended.waitFor();
  assert.match(await ended.innerText(), /종료될 온라인 게임[\s\S]*알림이[\s\S]*notice\.example\.com/);
  await ended.getByTestId('approve-report').click();
  await admin.getByTestId('admin-tab-approved').click();
  await admin.getByTestId('admin-report-card').first().waitFor();
  await admin.getByTestId('admin-kind-fix').click();
  const fixCard = admin.getByTestId('admin-report-card').filter({ hasText: '정보 고칠 게임' }).first();
  await fixCard.waitFor();
  assert.match(await fixCard.innerText(), /추천 인원: 2~4명[\s\S]*약 30시간/);
  await fixCard.getByTestId('approve-report').click();
  await admin.getByTestId('admin-kind-reviews').click();
  const rv = admin.getByTestId('admin-review-card').filter({ hasText: '광고왕' }).first();
  await rv.waitFor();
  assert.match(await rv.innerText(), /신고 1건[\s\S]*광고왕[\s\S]*광고·도배[\s\S]*알림이/);
  if (SHOTS) await admin.screenshot({ path: `${SHOTS}/admin-review-reports.png`, fullPage: true });
  await rv.getByTestId('hide-review').click();
  await admin.getByTestId('admin-tab-upheld').click();
  await admin.getByTestId('admin-review-card').first().waitFor();

  // 반영 확인
  await user.goto(`${base}/search?q=${encodeURIComponent('게임')}`);
  await user.getByTestId('game-card').first().waitFor();
  const titles = await user.getByTestId('game-card').allInnerTexts();
  assert.ok(!titles.some((t) => t.includes('종료될 온라인 게임')), '종료 게임은 검색에서 빠짐');
  // 종료 게임은 상세도 안 보임(회원) — 관리자에게만 종료 안내와 함께 열림
  await user.goto(`${base}/games/igdb-81`);
  await user.getByTestId('game-ended').waitFor();
  assert.equal(await user.getByTestId('game-detail').count(), 0);
  await admin.goto(`${base}/games/igdb-81`);
  await admin.getByTestId('user-ended-notice').waitFor();
  await user.goto(`${base}/games/igdb-82`);
  const detail = await user.getByTestId('game-detail').innerText();
  assert.match(detail, /추천 인원\s*2~4명[\s\S]*사용자 제보/);
  assert.match(detail, /약 30시간[\s\S]*사용자 제보 · 관리자 확인/);
  await user.getByTestId('reviews').waitFor();
  assert.equal(await user.getByTestId('review-item').count(), 0, '숨긴 리뷰는 다른 회원에게 안 보임');
  await writer.goto(`${base}/games/igdb-82`);
  await writer.getByTestId('review-hidden').waitFor();
  if (SHOTS) await user.screenshot({ path: `${SHOTS}/report-applied.png`, fullPage: true });
  assert.deepEqual(errors, []);
});
