// 추천 목록 첫 요청 속도: IGDB에 더 있으면 '비슷한 게임' 후보·게관위 게임을 기다리지 않고, IGDB가 끝나는 '더 보기' 응답에 붙임
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const game = (id, genres, count) => ({
  id, title: `게임 ${id}`, source: 'IGDB', platforms: ['pc'], genres, players: { min: 1, max: 4 }, recommendedPlayers: { min: 1, max: 4, source: 'igdb' },
  stores: [], imageUrl: null, altNames: [], globalRating: { avg: 4, count },
});
// 모든 조건 일치(퍼즐) 30개를 두 쪽으로 — 첫 쪽(48개 훑기)에서 12개 넘게 맞으니 IGDB는 '더 있음'
const FULL = Array.from({ length: 30 }, (_, i) => game(`igdb-${i + 1}`, ['puzzle'], 1000 - i));
const SIMILAR = game('igdb-900', ['action'], 5000); // 장르가 달라 일부 일치
const SLOW = 300;
const calls = { pool: 0, grac: 0 };
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async () => null,
  getMany: async () => [],
  findMatches: async (criteria, { offset }) => (offset === 0 ? { games: FULL.slice(0, 20), total: 30, hasMore: true } : { games: FULL.slice(20), total: 30, hasMore: false }),
  listGames: async () => {
    calls.pool++;
    await new Promise((r) => setTimeout(r, SLOW));
    return { games: [SIMILAR], warnings: [] };
  },
  gracMatches: async () => {
    calls.grac++;
    await new Promise((r) => setTimeout(r, SLOW));
    return { status: 'ready', items: [], total: 0, hasMore: false, nextOffset: 0 };
  },
};
const partySize = { configured: false, size: 0, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { catalog, partySize });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('IGDB에 더 있으면 첫 응답은 느린 후보를 기다리지 않음 → IGDB가 끝나는 더 보기에 비슷한 게임', async () => {
  const t0 = Date.now();
  const first = await (await fetch(`${base}/api/recommendations?genres=puzzle&platforms=pc`)).json();
  const ms = Date.now() - t0;
  assert.ok(ms < SLOW, `첫 응답이 느린 후보를 기다리지 않음 (${ms}ms)`);
  assert.equal(first.hasMoreFull, true);
  assert.equal(first.fullMatches.length, 20);
  assert.deepEqual(first.partialMatches, [], '비슷한 게임은 아직(모든 조건 일치를 다 본 뒤에만 보이므로)');
  assert.equal(calls.pool, 1, '후보는 미리 받기 시작해 캐시를 데움');

  const q = new URLSearchParams({ genres: 'puzzle', platforms: 'pc', more: 'full', offset: first.next.offset, goffset: first.next.goffset, cut: first.next.cut });
  const next = await (await fetch(`${base}/api/recommendations?${q}`)).json();
  assert.equal(next.igdbDone, true);
  assert.equal(next.fullMatches.length, 10);
  assert.deepEqual(next.partialMatches.map((x) => x.game.id), ['igdb-900'], 'IGDB가 끝나는 응답에 비슷한 게임 후보를 붙임');
});

test('모든 조건 일치가 없으면(IGDB가 첫 쪽에서 끝남) 첫 응답에 바로 비슷한 게임', async () => {
  const none = await (await fetch(`${base}/api/recommendations?genres=racing&platforms=pc`)).json();
  assert.equal(none.hasMoreFull, false);
  assert.ok(none.partialMatches.some((x) => x.game.id === 'igdb-900'));
});
