import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCriteria, evaluateGame, recommend, interleave } from '../server/services/recommend.js';
import { DEMO_GAMES } from '../server/data/demoGames.js';

const game = (o) => ({ id: 'x', title: 'x', players: null, platforms: null, genres: null, ...o });

test('조건 파싱: 유효/무효 값', () => {
  assert.deepEqual(parseCriteria({ players: '2', platforms: 'pc,console', genres: 'rpg' }).criteria, {
    players: 2, platforms: ['pc', 'console'], genres: ['rpg'],
  });
  assert.ok(parseCriteria({}).errors.length > 0, '조건이 없으면 오류');
  assert.ok(parseCriteria({ players: '0' }).errors.length > 0);
  assert.ok(parseCriteria({ platforms: 'nes' }).errors.length > 0);
});

test('인원수 판정: 범위, 5명 이상, 정보 없음', () => {
  const c = (n) => ({ players: n, platforms: [], genres: [] });
  assert.equal(evaluateGame(game({ players: { min: 1, max: 4 } }), c(3)).checks[0].status, 'match');
  assert.equal(evaluateGame(game({ players: { min: 1, max: 1 } }), c(2)).checks[0].status, 'mismatch');
  assert.equal(evaluateGame(game({ players: { min: 2, max: 10 } }), c(5)).checks[0].status, 'match');
  assert.equal(evaluateGame(game({ players: { min: 1, max: 4 } }), c(5)).checks[0].status, 'mismatch');
  assert.equal(evaluateGame(game({ players: null }), c(2)).checks[0].status, 'unknown');
});

test('플랫폼·장르: 하나라도 겹치면 일치, 데이터 없으면 unknown', () => {
  const crit = { players: null, platforms: ['pc', 'mobile'], genres: ['puzzle'] };
  const ev = evaluateGame(game({ platforms: ['mobile'], genres: null }), crit);
  assert.equal(ev.checks[0].status, 'match');
  assert.deepEqual(ev.checks[0].matched, ['모바일']);
  assert.equal(ev.checks[1].status, 'unknown');
  assert.equal(ev.isFullMatch, false);
});

test('추천: 전체 일치/일부 일치 분리, 일치 0개 제외, 정렬', () => {
  const crit = { players: 2, platforms: ['pc'], genres: ['rpg'] };
  const { fullMatches, partialMatches } = recommend(DEMO_GAMES, crit);
  assert.ok(fullMatches.length > 0);
  for (const r of fullMatches) assert.equal(r.evaluation.matchedCount, 3);
  for (const r of partialMatches) {
    assert.ok(r.evaluation.matchedCount >= 1 && r.evaluation.matchedCount < 3);
  }
  const counts = partialMatches.map((r) => r.evaluation.matchedCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), '일치 수 내림차순');
  assert.ok(fullMatches.some((r) => r.game.id === 'demo-02'), '던전 동맹(PC·RPG·1~4명)');
});

test('데모 데이터: 이미지 없음, 구매처는 데모 표시된 내부 경로만', () => {
  for (const g of DEMO_GAMES) {
    assert.equal(g.isDemo, true);
    assert.equal(g.imageUrl, null);
    for (const s of g.stores) {
      assert.equal(s.isDemo, true);
      assert.match(s.url, /^\/demo-store\//);
    }
  }
});

test('목록 합치기: 4개마다 1개씩 끼우고 남으면 뒤에', () => {
  assert.deepEqual(interleave([1, 2, 3, 4, 5, 6, 7, 8], ['a', 'b', 'c']), [1, 2, 3, 4, 'a', 5, 6, 7, 8, 'b', 'c']);
  assert.deepEqual(interleave([], ['a']), ['a']);
  assert.deepEqual(interleave([1, 2], []), [1, 2]);
});
