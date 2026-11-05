import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createCatalog } from '../server/services/catalog.js';

// 테스트 전용 가짜 게임위 항목 (실제 자료 아님)
const g = (no, title, platforms, genres, date = '2026-01-01') => ({
  id: `grac-${no}`, title, source: '게임물관리위원회', ratingNo: no, ratingDate: date,
  platforms, genres, players: null, domesticRating: true, stores: [], imageUrl: null,
});

function fakeGrac(all) {
  const calls = [];
  return {
    calls,
    label: '게임물관리위원회',
    async fetchPage({ pageno, display, startdate }) {
      calls.push({ pageno, startdate });
      const src = startdate ? all.filter((x) => x.ratingDate >= startdate) : all;
      return { total: src.length, games: src.slice((pageno - 1) * display, pageno * display) };
    },
    listGames: async () => [], searchByTitle: async () => [],
  };
}
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-')), 'idx.json');

test('색인: 전체 받기 → 저장, 같은 제목은 하나로, 하루 지나면 추가분만', async () => {
  const all = Array.from({ length: 2500 }, (_, i) => g(`N${i}`, `게임 ${i % 2400}`, ['mobile'], ['puzzle']));
  const grac = fakeGrac(all);
  let t = Date.parse('2026-03-01');
  const file = tmp();
  const idx = createGracIndex({ grac, cacheFile: file, now: () => t });
  assert.equal(idx.snapshot().status, 'building');
  await idx.ensure();
  const s = idx.snapshot();
  assert.equal(s.status, 'ready');
  assert.equal(s.games.length, 2400, '같은 제목 100쌍은 하나로');
  assert.equal(grac.calls.length, 3, '1000건씩 3페이지');
  assert.ok(fs.existsSync(file));

  // 다시 만들면 파일에서 바로 준비
  const again = createGracIndex({ grac, cacheFile: file, now: () => t });
  assert.equal(again.snapshot().status, 'ready');
  assert.equal(again.ensure(), null, '하루 안 지났으면 갱신 안 함');

  all.push(g('NEW1', '새 게임', ['pc'], ['rpg'], '2026-03-02'));
  t += 86_400_000 + 1;
  await again.ensure();
  assert.equal(grac.calls.at(-1).startdate, '2026-02-28', '마지막 갱신 하루 전부터');
  assert.ok(again.snapshot().games.some((x) => x.title === '새 게임'));
});

test('나만의 게임 찾기: IGDB에 없는 게임위 게임만, 플랫폼·장르 모두 일치, 최신순 페이지', async () => {
  const games = [
    g('A', '퍼즐 왕국', ['mobile'], ['puzzle'], '2026-05-01'),
    g('B', 'Tetris', ['mobile'], ['puzzle'], '2026-04-01'), // IGDB에 있음
    g('C', '크레인 게임', ['arcade'], null, '2026-03-01'), // 장르 정보 없음 → 제외
    g('D', '퍼즐 마을', ['pc'], ['puzzle'], '2026-02-01'), // 플랫폼 불일치 → 제외
    ...Array.from({ length: 30 }, (_, i) => g(`P${i}`, `퍼즐 ${i}`, ['mobile'], ['puzzle'], '2025-01-01')),
  ];
  const gracIndex = { ensure() {}, snapshot: () => ({ status: 'ready', games, updatedAt: 1 }) };
  const asked = [];
  const igdb = {
    label: 'IGDB', configured: true,
    async findTitles(names) {
      asked.push(names);
      return names.filter((n) => n === 'Tetris');
    },
  };
  const c = createCatalog({ dataSource: 'live', grac: {} }, { igdb, gracIndex, grac: { label: 'G' }, kr: { configured: false } });
  const criteria = { players: 2, platforms: ['mobile'], genres: ['puzzle'] };
  const r = await c.gracMatches(criteria, { offset: 0, limit: 24 });
  assert.equal(r.status, 'ready');
  assert.equal(r.items[0].game.title, '퍼즐 왕국', '최신 등급분류 먼저');
  assert.ok(!r.items.some((x) => x.game.title === 'Tetris'), 'IGDB에 있으면 제외');
  assert.ok(!r.items.some((x) => ['크레인 게임', '퍼즐 마을'].includes(x.game.title)));
  assert.equal(r.items.length, 24);
  assert.equal(r.items[0].evaluation.checks.find((x) => x.key === 'players').status, 'unknown');
  assert.equal(r.hasMore, true);
  const r2 = await c.gracMatches(criteria, { offset: r.nextOffset, limit: 24 });
  assert.equal(r2.items.length, 7);
  assert.equal(r2.hasMore, false);
  const ids = new Set([...r.items, ...r2.items].map((x) => x.game.id));
  assert.equal(ids.size, 31, '페이지 사이 중복·누락 없음');
  const before = asked.length;
  await c.gracMatches(criteria, { offset: 0, limit: 24 });
  assert.equal(asked.length, before, 'IGDB 확인 결과는 캐시');

  const onlyPlayers = await c.gracMatches({ players: 2, platforms: [], genres: [] });
  assert.equal(onlyPlayers.reason, 'NEED_PLATFORM_OR_GENRE');
  const building = createCatalog({ dataSource: 'live', grac: {} }, { igdb, gracIndex: { ensure() {}, snapshot: () => ({ status: 'building', progress: { done: 3, total: 34 } }) }, grac: { label: 'G' }, kr: { configured: false } });
  assert.deepEqual((await building.gracMatches(criteria)).progress, { done: 3, total: 34 });
});

test('예전 색인 파일(recommendedPlayers 키 없음)도 AI 추천 인원 대상이 되게 채워서 읽음', () => {
  const file = tmp();
  const old = { id: 'grac-OLD1', title: '옛 게임', source: '게임물관리위원회', ratingNo: 'OLD1', ratingDate: '2020-01-01', platforms: ['mobile'], genres: ['puzzle'], players: null, domesticRating: true, stores: [], imageUrl: null };
  fs.writeFileSync(file, JSON.stringify({ fullAt: Date.now(), updatedAt: Date.now(), games: [old] }));
  const idx = createGracIndex({ grac: fakeGrac([]), cacheFile: file });
  const [game] = idx.snapshot().games;
  assert.equal('recommendedPlayers' in game, true);
  assert.equal(game.recommendedPlayers, null);
});

test('IGDB에 있는지: 괄호 안 이름·플랫폼 표기로도 찾고, 꺼낸 이름으로만 맞으면 플랫폼도 맞아야 함', async () => {
  const { createExistenceCache, samePlatform } = await import('../server/services/catalog.js');
  assert.equal(samePlatform('모바일 게임', ['mobile', 'pc']), true);
  assert.equal(samePlatform('아케이드 게임', ['pc']), false);
  assert.equal(samePlatform('PC/온라인 게임, 비디오 게임', ['console']), true);
  assert.equal(samePlatform(null, ['pc']), true, '모르면 맞는 것으로');

  // 가짜 IGDB (실제 자료 아님)
  const IGDB = [
    { names: ['Portal 2', '포탈 2'], platforms: ['pc', 'console'] },
    { names: ['KartRider: Drift'], platforms: ['pc', 'console'] },
    { names: ['Greedy Snake'], platforms: ['mobile'] },
  ];
  const asked = [];
  const find = async (names) => {
    asked.push(...names);
    const keys = new Set(names.map((n) => n.toLowerCase().replace(/[\s\p{P}]/gu, '')));
    return IGDB.filter((g) => g.names.some((n) => keys.has(n.toLowerCase().replace(/[\s\p{P}]/gu, ''))));
  };
  const raw = { 'Portal 2(포탈 2)_PC': 'PC/온라인 게임', '카트라이더 드리프트 (Kartrider Drift) [PC]': 'PC/온라인 게임', '그리디 스네이크 (Greedy Snake)': '아케이드 게임', '없는 게임': '모바일 게임' };
  const cache = createExistenceCache(null);
  const found = await cache.check(Object.keys(raw), find, { platformsOf: (t) => raw[t] });
  assert.deepEqual([...found].sort(), ['Portal 2(포탈 2)_PC', '카트라이더 드리프트 (Kartrider Drift) [PC]'].sort());
  assert.ok(asked.includes('Kartrider Drift') && asked.includes('Portal 2'), '꺼낸 이름으로 물음');
  assert.equal(cache.known('그리디 스네이크 (Greedy Snake)'), false, '아케이드 게임 ↔ 모바일 게임: 다른 게임으로 봄');

  // 예전 방식(v 없음)으로 '없음'이 된 항목은 다시 확인, '있음'은 그대로
  const fsm = await import('node:fs');
  const file = tmp();
  fsm.writeFileSync(file, JSON.stringify({ 'Portal 2(포탈 2)_PC': { exists: false, at: Date.now() }, 'Tetris': { exists: true, at: Date.now() } }));
  const old = createExistenceCache(file);
  assert.equal(old.known('Portal 2(포탈 2)_PC'), undefined, '다시 확인 대상');
  assert.equal(old.known('Tetris'), true);
});
