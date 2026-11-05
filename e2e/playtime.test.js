// E2E: 플레이 시간이 없는 게임 상세 — 로그인 안 하면 안내, 로그인하면 AI 추정을 불러와 표시(한 번만 물음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const GAME = { id: 'igdb-501', title: 'Quiet Quest', source: 'IGDB', platforms: ['pc'], genres: ['rpg'], players: null, stores: [], imageUrl: null, altNames: [] };
const GAME2 = { ...GAME, id: 'igdb-502', title: 'Recorded Quest' };
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => (id === GAME.id ? GAME : id === GAME2.id ? GAME2 : null),
  // 가짜 IGDB 이용자 기록 (실제 자료 아님)
  timeToBeat: async (id) => (id === GAME2.id ? { hastily: 8, normally: 12, completely: 30, count: 5 } : null),
  browse: async () => ({ games: [], hasMore: false }),
  search: async () => ({ games: [], warnings: [] }),
  featured: async () => [],
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };
let geminiCalls = 0;
const fetchImpl = async (url) => {
  if (!String(url).includes('generativelanguage')) throw new Error(`예상 못 한 호출 ${url}`);
  geminiCalls++;
  await new Promise((r) => setTimeout(r, 300)); // 'AI 추정 중…'이 잠깐 보이게
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"hours":27}' }] } }] }) };
};

let server, base, browser;
before(async () => {
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', appStore: {}, aiPlaytime: { apiKey: 'k', live: true, dailyLimit: 10 } },
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

const playtimeRow = (page) => page.locator('.info-table div', { hasText: '평균 플레이 시간' });

test('로그인 안 함: 로그인 후 확인 가능 안내, AI는 부르지 않음', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  await page.goto(`${base}/games/${GAME.id}`);
  const note = page.getByTestId('playtime-login');
  await note.waitFor();
  assert.match(await note.textContent(), /로그인 후 AI 추정 플레이 시간을 확인할 수 있어요/);
  assert.match(await note.getByRole('link', { name: '로그인' }).getAttribute('href'), /^\/login\?next=%2Fgames%2Figdb-501/);
  assert.equal(geminiCalls, 0);
  await page.close();
});

test('로그인함: AI 추정 중… → AI 추정 값, 다시 열면 바로 보이고 AI는 한 번만', async () => {
  const ctx = await browser.newContext({ locale: 'ko-KR' });
  const r = await ctx.request.post(`${base}/api/auth/signup`, {
    headers: { 'X-Requested-With': 'playpick' },
    data: { loginId: 'pttester', password: 'secret123', nickname: 'pttester', email: 'pt@example.com' },
  });
  assert.equal(r.status(), 201);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/games/${GAME.id}`);
  await page.getByTestId('playtime-loading').waitFor();
  await page.getByTestId('playtime-ai').waitFor();
  assert.match(await playtimeRow(page).textContent(), /약 27시간/);
  assert.equal(geminiCalls, 1);

  // 로그아웃한 다른 사람이 열어도 저장된 값이 바로
  const anon = await browser.newPage({ locale: 'ko-KR' });
  await anon.goto(`${base}/games/${GAME.id}`);
  await anon.getByTestId('playtime-ai').waitFor();
  assert.equal(await anon.getByTestId('playtime-login').count(), 0);
  assert.equal(geminiCalls, 1, 'AI는 한 번만');
  assert.deepEqual(errors, []);
  await anon.close();
  await ctx.close();
});

test('IGDB 이용자 기록 플레이 시간: 뜻을 풀어 쓴 표시', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  await page.goto(`${base}/games/${GAME2.id}`);
  const p = page.getByTestId('playtime-igdb');
  await p.waitFor();
  const text = await p.textContent();
  assert.ok(text.includes('약 12시간 (메인 스토리 + 서브 퀘스트 조금)'), text);
  assert.match(text, /메인 스토리만 약 8시간 · 모든 요소 100% 완료 약 30시간/);
  assert.match(text, /IGDB 이용자 5명 기록/);
  assert.equal(await page.getByTestId('playtime-login').count(), 0, 'IGDB 값이 있으면 로그인 안내 없음');
  await page.close();
});
