// E2E: 관리자 '게관위 새 게임' 탭 — 지금 받기 → 결과·목록(스토어 근거·AI 인원) → 새 게임이 상세에서 열림
// (가짜 게관위·Steam·Gemini)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { createPartySize } from '../server/services/partySize.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const today = new Date().toISOString().slice(0, 10);
const G = (no, title, extra = {}) => ({
  id: `grac-${no}`, title, source: '게임물관리위원회', publisher: '테스트게임즈', platforms: ['pc'], platformsRaw: 'PC/온라인 게임',
  genres: ['action'], genresRaw: '액션', players: null, recommendedPlayers: null, ratingNo: no, ratingDate: today, stores: [], imageUrl: null, ...extra,
});
const SEED = [G('OLD-1', '예전 게임', { ratingDate: '2026-01-01' })];
const NEW = [G('E-1', '친구 파티 대전'), G('E-2', '어디에도 없는 게임')];
const grac = { fetchPage: async () => ({ total: NEW.length, games: NEW }) };
const fakeFetch = async (url, opt = {}) => {
  const u = new URL(String(url));
  if (u.pathname === '/api/storesearch/') {
    return Response.json({ items: u.searchParams.get('term') === '친구 파티 대전' ? [{ type: 'app', id: 11, name: '친구 파티 대전' }] : [] });
  }
  if (u.pathname === '/api/appdetails') {
    const data = { short_description: '친구와 2~4인 파티 대전', categories: [{ description: 'Online Co-op' }], release_date: { coming_soon: false } };
    return Response.json({ 11: { success: true, data } });
  }
  if (u.host === 'generativelanguage.googleapis.com') {
    const prompt = JSON.parse(opt.body).contents[0].parts[0].text;
    const ans = prompt.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).map((x) => ({ id: x.id, min: 2, max: 4, hours: null }));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }], modelVersion: 'fake' });
  }
  throw new Error(`unexpected ${url}`);
};

let server, base, browser, tmp;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-gracnew-'));
  const dataFile = path.join(tmp, 'party-size.json');
  fs.writeFileSync(dataFile, JSON.stringify({ 'grac:다른게임': { status: 'released', ended: false } }));
  let extra = [];
  const all = () => [...SEED, ...extra];
  const catalog = {
    meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
    gracFeed: { grac, seedGames: () => SEED, setExtra: (g) => (extra = g) },
    getGame: async (id) => all().find((g) => g.id === id) ?? null,
    browse: async () => ({ games: [], hasMore: false }),
    search: async () => ({ games: all(), warnings: [] }),
    domesticGames: () => all(),
  };
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, hideUnknownGrac: true, gemini: { apiKey: 'test-key' }, adminEmails: ['admin@example.com'] },
    { catalog, partySize: createPartySize({ dataFile }), gracNewFetch: fakeFetch, appStore: { enabled: false } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('관리자: 게관위 새 게임 받기 → 결과·목록, 찾은 게임은 상세에 스토어·AI 인원', async () => {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const r = await page.request.post(`${base}/api/auth/signup`, { data: { loginId: 'e2e_gadm', password: 'secret123', nickname: '운영자', email: 'admin@example.com' }, headers: { 'X-Requested-With': 'playpick' } });
  assert.equal(r.status(), 201);

  await page.goto(`${base}/admin`);
  await page.getByTestId('admin-kind-grac').click();
  await page.getByTestId('grac-new-last').getByText('아직 한 번도 받지 않았어요.').waitFor();
  await page.getByTestId('grac-new-run').click();
  await page.getByTestId('grac-new-result').getByText(/새 게임 2개/).waitFor();
  await page.getByTestId('grac-new-last').getByText(/마지막 실행/).waitFor();
  const items = page.getByTestId('grac-new-item');
  assert.equal(await items.count(), 2);
  const found = items.filter({ hasText: '친구 파티 대전' });
  await found.getByText('서비스 중').waitFor();
  await found.getByText(/AI 추정 2~4명/).waitFor();
  await items.filter({ hasText: '어디에도 없는 게임' }).getByText(/스토어에서 못 찾음\(1번\)/).waitFor();

  // 상세: Steam 구매처·AI 추정 인원
  await found.getByRole('link', { name: '친구 파티 대전' }).click();
  await page.waitForURL(/\/games\/grac-E-1/);
  await page.getByRole('link', { name: /Steam/ }).first().waitFor();
  // 못 찾은 게임: '새 등급분류' 안내
  await page.goto(`${base}/games/grac-E-2`);
  await page.getByTestId('ai-recent-notice').waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});
