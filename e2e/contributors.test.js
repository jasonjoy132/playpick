// E2E: 제보 승인 → 평점 랭킹 '기여자 TOP' 1위 · 홈 '이달의 기여자' · 내 제보 '내 기여가 만든 변화'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const H = { 'X-Requested-With': 'playpick' };

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
  const page = await (await browser.newContext({ locale: 'ko-KR', viewport })).newPage();
  const r = await page.request.post(`${base}/api/auth/signup`, { data: { password: 'secret123', ...account }, headers: H });
  assert.equal(r.status(), 201);
  return page;
}

test('기여자 순위·홈 줄·내 기여 요약', async () => {
  const errors = [];
  const maker = await signedIn({ loginId: 'e2e_maker', nickname: '발굴왕', email: 'maker@example.com' });
  maker.on('pageerror', (e) => errors.push(e.message));
  const admin = await signedIn({ loginId: 'e2e_boss', nickname: '운영자', email: 'admin@example.com' });
  const fan = await signedIn({ loginId: 'e2e_fan', nickname: '찜팬', email: 'fan@example.com' });

  // 아직 아무도 없으면 빈 안내, 홈 줄은 숨김
  await fan.goto(`${base}/ranking?tab=contributors`);
  await fan.getByTestId('contrib-empty').waitFor();
  await fan.goto(base);
  await fan.getByTestId('hero-finder').waitFor();
  assert.equal(await fan.getByTestId('home-contributors').count(), 0);

  const s = await maker.request.post(`${base}/api/submissions`, { data: { title: '순위 협동 게임', platforms: ['pc'], genres: ['puzzle'] }, headers: H });
  const { item } = await s.json();
  await admin.request.post(`${base}/api/admin/submissions/${item.id}/approve`, { headers: H });
  await fan.request.put(`${base}/api/wishlist/user-${item.id}`, { headers: H });

  // 평점 랭킹 → 기여자 TOP 탭
  await maker.goto(`${base}/ranking`);
  await maker.getByRole('tab', { name: '기여자 TOP' }).click();
  await maker.waitForURL(/tab=contributors/);
  const first = maker.getByTestId('contrib-item').first();
  assert.match(await first.innerText(), /발굴왕[\s\S]*4점[\s\S]*승인 3 \+ 반응 1/);
  assert.match(await maker.getByTestId('contrib-me').innerText(), /내 순위 1위/);
  assert.equal(await maker.getByTestId('contrib-item').count(), 1, '관리자는 순위에 없음');
  await maker.getByTestId('contrib-all').click();
  await maker.getByTestId('contrib-item').first().waitFor();
  await maker.getByText('점수는 어떻게 매기나요?').click();

  // 홈 '이달의 기여자' → 전체 보기
  await maker.goto(base);
  const row = maker.getByTestId('home-contributors');
  assert.match(await row.innerText(), /의 기여자[\s\S]*발굴왕/);
  await row.getByRole('link', { name: /전체 보기/ }).click();
  await maker.getByTestId('contrib-ranking').waitFor();

  // 내 제보: 기여 요약 + 승인 카드 숫자
  await maker.goto(`${base}/mypage/submissions`);
  assert.match(await maker.getByTestId('impact').innerText(), /내 기여가 만든 변화[\s\S]*1\s*채운 게임[\s\S]*1\s*찜/);
  assert.equal(await maker.getByTestId('impact-line').first().getAttribute('aria-label'), '조회 0회, 찜 1개, 리뷰 0개');
  assert.deepEqual(errors, []);
});

test('모바일 폭: 기여자 순위·홈 줄에 가로 스크롤 없음', async () => {
  const page = await signedIn({ loginId: 'e2e_mobile', nickname: '모바일러', email: 'mob@example.com' }, { width: 375, height: 760 });
  for (const path of ['/ranking?tab=contributors', '/']) {
    await page.goto(base + path);
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${path} 가로 스크롤 없음`);
  }
});
