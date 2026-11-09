// E2E: 목록에서 상세를 봤다가 돌아오면 떠나기 전 그대로(더 보기로 펼친 목록·스크롤 위치, 다시 받지 않음)
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

const many = Array.from({ length: 60 }, (_, i) => ({
  game: { id: `demo-x${i}`, title: `게임 ${i}`, isDemo: true, players: null, platforms: ['pc'], genres: null, stores: [] },
  evaluation: { checks: [{ key: 'platforms', label: '플랫폼', status: 'match', matched: ['PC'] }], matchedCount: 1, mismatchCount: 0, unknownCount: 0, totalCount: 1, isFullMatch: true },
}));

async function openList(page) {
  let calls = 0;
  await page.route('**/api/recommendations?**', (route) => {
    calls++;
    return route.fulfill({ json: { meta: { isDemo: true, sources: ['데모 데이터'] }, criteria: {}, totalGames: 60, warnings: [], fullMatches: many, partialMatches: [] } });
  });
  await page.goto(`${base}/results?platforms=pc`);
  const cards = page.getByTestId('section-full').getByTestId('game-card');
  await cards.first().waitFor();
  await page.getByTestId('more-full').dispatchEvent('click'); // 24 → 48개
  assert.equal(await cards.count(), 48);
  const card = cards.nth(40);
  await card.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  assert.ok(y > 1000, '아래까지 내려감');
  await card.getByRole('link').click();
  await page.waitForURL(/\/games\/demo-x40/);
  return { cards, y, calls: () => calls };
}

test('상세에서 브라우저 뒤로 가기 → 펼친 목록·스크롤 위치 그대로, 다시 받지 않음', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const { cards, y, calls } = await openList(page);
  await page.goBack();
  await page.waitForURL(/\/results\?platforms=pc$/);
  await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 5, y);
  // 더 보기로 펼친 만큼 그대로(돌아온 위치가 아래쪽이라 남은 12개가 자동으로 더 펼쳐질 수 있음)
  assert.ok((await cards.count()) >= 48, '더 보기로 펼친 만큼 그대로');
  assert.equal(calls(), 1, '목록을 다시 받지 않음');
  await page.close();
});

test("상세의 '← 추천 목록으로'도 새로 열지 않고 떠나기 전 그대로", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const { cards, y, calls } = await openList(page);
  await page.getByRole('link', { name: '← 추천 목록으로' }).click();
  await page.waitForURL(/\/results\?platforms=pc$/);
  await page.waitForFunction((want) => Math.abs(window.scrollY - want) < 5, y);
  assert.ok((await cards.count()) >= 48);
  assert.equal(calls(), 1);
  // 뒤로 간 것이므로 앞으로 가기에 상세가 남아 있음
  await page.goForward();
  await page.waitForURL(/\/games\/demo-x40/);
  await page.close();
});

test('새로 연 목록은 맨 위에서 시작', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openList(page);
  await page.getByRole('link', { name: '홈' }).first().click();
  await page.waitForURL(`${base}/`);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.close();
});
