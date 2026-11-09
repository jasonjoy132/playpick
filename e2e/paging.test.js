// E2E: '나만의 게임 찾기' 전체 검색 결과의 서버 페이지 '더 보기'
// 가짜 카탈로그(테스트 전용 데이터)를 주입해 IGDB 없이 화면 동작만 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { evaluateGame } from '../server/services/recommend.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// '더 보기'는 dispatchEvent('click')으로 누름: 보통 click()은 버튼까지 스크롤해서 스크롤 자동 불러오기(AutoMore)가 같이 일어나
// 페이지를 미리 다 받아 버리거나 버튼이 밀려나 가끔 실패했음
const TOTAL = 60;
const fake = (i) => ({
  id: `igdb-${9000 + i}`, title: `테스트 게임 ${i + 1}`, source: 'IGDB',
  players: { min: 1, max: 4 }, platforms: ['pc'], genres: ['action'], stores: [], imageUrl: null,
});
const calls = [];
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  async findMatches(criteria, { offset, limit }) {
    calls.push(offset);
    const games = Array.from({ length: TOTAL }, (_, i) => fake(i)).slice(offset, offset + limit);
    return { games, total: offset === 0 ? TOTAL : null, hasMore: offset + limit < TOTAL };
  },
  async gracMatches(criteria, { offset, limit }) {
    const all = Array.from({ length: 30 }, (_, i) => {
      const ai = criteria.genres.includes('shooting'); // 이 장르로 찾을 때만 'AI 추정 대상' 게임위 게임으로
      const game = { id: `grac-T${i}`, title: `국내 테스트 게임 ${i + 1}`, source: '게임물관리위원회', players: null, platforms: ['pc'], genres: ai ? ['shooting'] : ['action'], stores: [], imageUrl: null, domesticRating: true, ...(ai ? { recommendedPlayers: null } : {}) };
      return { game, evaluation: evaluateGame(game, criteria) };
    });
    const items = all.slice(offset, offset + limit);
    return { status: 'ready', items, total: 30, nextOffset: offset + items.length, hasMore: offset + limit < 30 };
  },
  async browse() {
    return { games: [], hasMore: false };
  },
  domesticGames: () => [
    { id: 'grac-UP1', title: '곧 나올 국내 게임', source: '게임물관리위원회', platforms: ['mobile'], genres: ['rpg'], players: null, stores: [], imageUrl: null, ratingDate: '2026-10-01', aiUpcoming: true },
    { id: 'grac-OLD', title: '서비스 중 게임', source: '게임물관리위원회', platforms: ['mobile'], genres: ['rpg'], players: null, stores: [], imageUrl: null, ratingDate: '2026-09-01' },
  ],
  async getGame(id) {
    if (id === 'igdb-778') return { id, title: '테스트 RPG', source: 'IGDB', players: { min: 1, max: 1 }, recommendedPlayers: { min: 1, max: 1, source: 'igdb' }, aiPlaytime: 30, platforms: ['pc'], genres: ['rpg'], stores: [], imageUrl: null, altNames: [], screenshots: ['data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'data:image/gif;base64,R0lGODlhAQABAAAAACwA'], screenshotSource: 'IGDB' };
    return id === 'igdb-777'
      ? { id, title: '테스트 배틀로얄', originalTitle: 'Test Royale', source: 'IGDB', players: { min: 1, max: 100 }, recommendedPlayers: null, platforms: ['pc'], genres: ['shooting'], stores: [], imageUrl: null, altNames: [] }
      : null;
  },
  async listGames() {
    return { games: [{ ...fake(100), title: '일부 일치 게임', genres: ['puzzle'] }], warnings: [] };
  },
};

let server, base, browser;
before(async () => {
  // 테스트용 AI: 실제 Gemini를 부르지 않고 정해진 값만 붙임
  const partySize = {
    configured: true,
    applyCached: (games) => games,
    fill: async (games) => ({ games: games.map((g) => (g.recommendedPlayers === null ? { ...g, recommendedPlayers: { min: 1, max: 4, source: 'ai' } } : g)), warning: null }),
  };
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { catalog, partySize });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('전체 검색: 개수 표시, 더 보기로 다음 페이지 요청', async () => {
  const page = await (await browser.newContext({ locale: 'ko-KR' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/results?players=2&platforms=pc&genres=action`);
  const full = page.getByTestId('section-full');
  await full.waitFor();
  assert.match(await page.getByTestId('result-count').innerText(), /IGDB와 게임물관리위원회 전체에서 찾았어요.*약 60개/);
  assert.equal(await full.getByTestId('game-card').count(), 24);
  await page.getByTestId('more-full').dispatchEvent('click'); // 받아 둔 48개 중 나머지
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="section-full"] [data-testid="game-card"]').length === 48);
  await page.getByTestId('more-full').dispatchEvent('click'); // 서버에서 다음 페이지
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="section-full"] [data-testid="game-card"]').length === 60);
  assert.equal(await page.getByTestId('more-full').count(), 0, '마지막 페이지면 버튼 없음');
  assert.deepEqual(calls, [0, 48]);
  // 모든 조건 일치가 있으면 '일부 조건 일치'(인원 모르는 게임위 게임 포함)는 보여 주지 않음
  assert.equal(await page.getByTestId('section-partial').count(), 0, '일부 일치 칸 없음');
  assert.equal(await page.getByTestId('section-grac').count(), 0, '따로 된 칸 없음');
  assert.deepEqual(errors, []);
});

test('인원을 안 고르면 게임위 게임이 모든 조건 일치 목록에 섞여 나옴', async () => {
  const page = await (await browser.newContext({ locale: 'ko-KR' })).newPage();
  await page.goto(`${base}/results?platforms=pc&genres=action`);
  const full = page.getByTestId('section-full');
  await full.getByTestId('game-card').first().waitFor();
  const titles = await full.getByTestId('game-card').allInnerTexts();
  assert.equal(titles.length, 24, '첫 화면 24개');
  assert.ok(titles[4].includes('국내 테스트 게임 1'), 'IGDB 4개마다 게임위 1개');
  await full.getByTestId('more-full').dispatchEvent('click');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="section-full"] [data-testid="game-card"]').length === 48);
});

test('상세: AI 추정 추천 인원은 표시를 달고, 최대 인원도 함께', async () => {
  const page = await (await browser.newContext({ locale: 'ko-KR' })).newPage();
  await page.goto(`${base}/games/igdb-777`);
  await page.getByTestId('party-ai').waitFor();
  const text = await page.locator('main').innerText();
  assert.match(text, /추천 인원\s*1~4명/);
  assert.match(text, /최대 인원\s*1~100명/);
});

test('API: 게임위 게임도 AI 추천 인원이 붙으면 모든 조건 일치로 올라감', async () => {
  const r = await (await fetch(`${base}/api/recommendations?players=2&platforms=pc&genres=shooting`)).json();
  const g = r.fullMatches.filter((x) => x.game.source === '게임물관리위원회');
  assert.equal(g.length, 24);
  assert.deepEqual(g[0].game.recommendedPlayers, { min: 1, max: 4, source: 'ai' });
  assert.ok(!r.partialMatches.some((x) => x.game.source === '게임물관리위원회'));
});

test('상세: RAWG에 플레이 시간이 없으면 AI 추정(메인 스토리 기준)으로 표시', async () => {
  const page = await (await browser.newContext({ locale: 'ko-KR' })).newPage();
  await page.goto(`${base}/games/igdb-778`);
  await page.getByTestId('playtime-ai').waitFor();
  assert.match(await page.locator('main').innerText(), /평균 플레이 시간\s*약 30시간 \(메인 스토리 기준\)/);
  const shots = page.getByTestId('screenshots');
  assert.match(await shots.innerText(), /스크린샷\s*출처: IGDB/);
  assert.equal(await shots.locator('img').count(), 2);
});

test('출시 예정: AI가 미출시로 판단한 게임위 게임은 국내 출시 예정 칸에', async () => {
  const page = await (await browser.newContext({ locale: 'ko-KR' })).newPage();
  await page.goto(`${base}/new?tab=upcoming`);
  const sec = page.getByTestId('domestic-upcoming');
  await sec.waitFor();
  assert.equal(await sec.getByTestId('game-card').count(), 1);
  assert.match(await sec.innerText(), /곧 나올 국내 게임[\s\S]*등급분류/);
  assert.match(await sec.getByTestId('game-card').innerText(), /출시 예정/);
});
