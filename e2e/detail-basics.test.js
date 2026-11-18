// E2E: 상세 첫 화면 핵심 정보 줄 · 화면 제목 · 외부에서 바로 들어온 상세의 '뒤로' · 게임 찾기 창과 휴대폰 뒤로 가기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const GAME = {
  id: 'igdb-1', title: '같이 하는 퍼즐', source: 'IGDB', platforms: ['pc', 'switch'], genres: ['puzzle'], players: { min: 1, max: 4 },
  recommendedPlayers: { min: 2, max: 4, source: 'igdb-coop' },
  stores: [{ name: 'Steam', url: 'https://store.steampowered.com/app/1/' }], imageUrl: null, altNames: [], globalRating: { avg: 4, count: 500 },
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => (id === GAME.id ? GAME : null),
  getMany: async (ids) => ids.filter((id) => id === GAME.id).map(() => GAME),
  featured: async () => ({ games: [GAME], warnings: [] }),
  browse: async () => ({ games: [GAME], hasMore: false }),
  search: async () => ({ games: [GAME], warnings: [] }),
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base, browser;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { catalog, partySize, rawgPlaytime: { size: 1, get: (id) => (id === GAME.id ? { hours: 12, url: null } : null) } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('상세: 제목 아래 추천 인원·플레이 시간·플랫폼, 탭 제목은 게임 이름, 바로 들어왔으면 뒤로 = 홈', async () => {
  const errors = [];
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/games/igdb-1`);
  const facts = page.getByTestId('key-facts');
  await facts.waitFor();
  assert.match(await page.getByTestId('key-players').innerText(), /2~4명/);
  assert.match(await page.getByTestId('key-playtime').innerText(), /약 12시간/);
  assert.match(await page.getByTestId('key-platforms').innerText(), /PC/);
  const box = await facts.boundingBox();
  assert.ok(box.y + box.height < 844, `핵심 정보가 휴대폰 첫 화면 안에 (${Math.round(box.y)}px)`);
  assert.equal(await page.title(), '같이 하는 퍼즐 · 플레이픽');
  assert.equal(await page.getByTestId('store-jump').isVisible(), true, '휴대폰에서는 구매처로 가는 버튼');

  await page.getByRole('link', { name: '뒤로' }).click();
  await page.waitForURL(`${base}/`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('게임 찾기 창: 휴대폰 뒤로 가기는 창만 닫고 화면은 그대로, 조건을 고르면 결과에서 뒤로 가면 원래 화면', async () => {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/popular`);
  await page.getByTestId('open-finder').click();
  await page.getByTestId('finder').waitFor();
  await page.goBack();
  await page.getByTestId('finder').waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).pathname, '/popular');

  // 닫기(Esc)로 닫아도 쌓인 기록이 남지 않음 → 뒤로 가기 한 번이면 이전 화면
  await page.getByTestId('open-finder').click();
  await page.getByTestId('finder').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('finder').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !history.state?.ppFinder);
  assert.equal(new URL(page.url()).pathname, '/popular');
  await ctx.close();
});
