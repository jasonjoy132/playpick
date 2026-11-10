// E2E: 추천 인원이 없는 게임 상세 — 로그인 안 하면 안내, 로그인하면 AI 추정 인원을 불러와 표시(한 번만 물음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { createPartySize } from '../server/services/partySize.js';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const GAME = { id: 'igdb-601', title: 'Couch Party', source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, recommendedPlayers: null, stores: [], imageUrl: null, altNames: [] };
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => (id === GAME.id ? GAME : null),
  browse: async () => ({ games: [], hasMore: false }),
  search: async () => ({ games: [], warnings: [] }),
  featured: async () => [],
};
// 진짜 partySize(파일 없음): 상세에서 물어 저장한 인원을 다시 열 때 붙여 줌
const partySize = createPartySize({ dataFile: path.join(os.tmpdir(), 'pp-e2e-players-none.json') });
let geminiCalls = 0;
const fetchImpl = async (url) => {
  if (!String(url).includes('generativelanguage')) throw new Error(`예상 못 한 호출 ${url}`);
  geminiCalls++;
  await new Promise((r) => setTimeout(r, 300)); // 'AI 추정 중…'이 잠깐 보이게
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"min":2,"max":4}' }] } }] }) };
};

let server, base, browser;
before(async () => {
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', appStore: {}, aiPlayers: { apiKey: 'k', live: true, dailyLimit: 10 } },
    { catalog, partySize, fetchImpl, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const playersRow = (page) => page.locator('.info-table div', { hasText: '추천 인원' });

test('로그인 안 함: 로그인 후 확인 가능 안내, AI는 부르지 않음', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  await page.goto(`${base}/games/${GAME.id}`);
  const note = page.getByTestId('players-login');
  await note.waitFor();
  assert.match(await note.textContent(), /로그인 후 AI 추정 추천 인원을 확인할 수 있어요/);
  assert.equal(geminiCalls, 0);
  await page.close();
});

test('로그인함: AI 추정 중… → 2~4명 AI 추정, AI는 한 번만', async () => {
  const ctx = await browser.newContext({ locale: 'ko-KR' });
  const r = await ctx.request.post(`${base}/api/auth/signup`, {
    headers: { 'X-Requested-With': 'playpick' },
    data: { loginId: 'pltester', password: 'secret123', nickname: 'pltester', email: 'pl@example.com' },
  });
  assert.equal(r.status(), 201);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/games/${GAME.id}`);
  await page.getByTestId('players-loading').waitFor();
  await page.getByTestId('players-asked').waitFor();
  const text = await playersRow(page).first().textContent();
  assert.match(text, /2.*4/);
  assert.match(text, /AI 추정/);
  assert.equal(geminiCalls, 1);
  await page.reload();
  await page.getByTestId('party-ai').waitFor();
  assert.equal(geminiCalls, 1, '다시 열면 저장된 값');
  assert.deepEqual(errors, []);
  await ctx.close();
});
