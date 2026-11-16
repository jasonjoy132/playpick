// E2E: 나를 위한 추천 — 비회원은 로그인 안내, 회원은 찜·별점으로 고른 게임이 이유와 함께
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
const game = (id, title, genres, count, players) => ({
  id, title, source: 'IGDB', platforms: ['pc'], genres, players: null, recommendedPlayers: { min: players[0], max: players[1], source: 'igdb' },
  stores: [], imageUrl: null, altNames: [], globalRating: { avg: 4, count },
});
const GAMES = {
  'igdb-1': game('igdb-1', '좋아하는 퍼즐 게임', ['puzzle'], 500, [2, 4]),
  'igdb-2': game('igdb-2', '같이 푸는 퍼즐', ['puzzle'], 400, [2, 2]),
  'igdb-3': game('igdb-3', '인기 레이싱', ['racing'], 9000, [1, 8]),
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  getMany: async (ids) => ids.map((id) => GAMES[id]).filter(Boolean),
  featured: async () => ({ games: Object.values(GAMES), warnings: [] }),
  browse: async (kind, { genre, offset = 0 } = {}) => ({ games: offset ? [] : Object.values(GAMES).filter((g) => !genre || g.genres.includes(genre)).sort((a, b) => b.globalRating.count - a.globalRating.count), hasMore: false }),
  search: async () => ({ games: Object.values(GAMES), warnings: [] }),
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base, browser;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { catalog, partySize });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('나를 위한 추천: 비회원 안내 → 회원이 찜하면 같은 장르 게임이 이유와 함께', async () => {
  const errors = [];
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${base}/for-you`);
  await page.getByTestId('for-you-login').waitFor();

  assert.equal((await page.request.post(`${base}/api/auth/signup`, { data: { loginId: 'e2e_fy', password: 'secret123', nickname: '추천받는이', email: 'fy2@example.com' }, headers: { 'X-Requested-With': 'playpick' } })).status(), 201);
  await page.request.put(`${base}/api/wishlist/igdb-1`, { headers: { 'X-Requested-With': 'playpick' } });

  // 홈 프로필 패널에서 들어가기
  await page.goto(`${base}/`);
  await page.getByTestId('pp-for-you').click();
  await page.getByTestId('for-you').getByTestId('game-card').first().waitFor();
  const cards = await page.getByTestId('for-you').getByTestId('game-card').allInnerTexts();
  assert.equal(cards.length, 1, '찜한 게임은 빼고 퍼즐 게임만');
  assert.match(cards[0], /같이 푸는 퍼즐[\s\S]*찜한 「좋아하는 퍼즐 게임」처럼 퍼즐 · 2명/);
  assert.equal(await page.getByTestId('for-you-need-more').count(), 1, '활동이 적으면 안내');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/for-you.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();
});
