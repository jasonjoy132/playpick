import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

// 인기 게임 정렬: 글로벌(IGDB 평가 수) · PlayPick(회원 평가 수) · 합계(둘을 그대로 더함)
let server, base;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', baseUrl: 'http://pp.test' }, { mailer: { configured: true, devLog: false, send: async () => {} } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function member(n) {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick' },
    body: JSON.stringify({ loginId: `pop_user${n}`, password: 'secret123', nickname: `인기${n}`, email: `pop${n}@example.com` }),
  });
  assert.equal(res.status, 201);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (gameId, rating) =>
    fetch(`${base}/api/games/${gameId}/reviews/mine`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick', Cookie: cookie }, body: JSON.stringify({ rating }) });
}
const list = async (q) => (await fetch(`${base}/api/browse/popular${q}`)).json();

test('인기 게임: PlayPick·합계 정렬', async () => {
  const before = await list('?sort=total');
  const globalIds = (await list('')).games.map((g) => g.id);
  assert.deepEqual(before.games.map((g) => g.id), globalIds.slice(0, before.games.length), '회원 평가가 없으면 합계 = 글로벌 순서');
  assert.equal((await list('?sort=playpick')).games.length, 0, '회원 평가가 없으면 PlayPick 인기는 비어 있음');

  const [a, b] = [await member(1), await member(2)];
  const last = globalIds.at(-1);
  const second = globalIds[1];
  assert.equal((await a(last, 5)).status, 200);
  assert.equal((await b(last, 3)).status, 200);
  assert.equal((await a(second, 4)).status, 200);

  const pp = await list('?sort=playpick');
  assert.deepEqual(pp.games.map((g) => [g.id, g.userRating.count]), [[last, 2], [second, 1]], '회원 평가 많은 순');

  const total = await list('?sort=total');
  const top = total.games[0];
  assert.equal(top.totalCount, (top.globalRating?.count ?? 0) + top.userRating.count, '합계 = 글로벌 + PlayPick');
  for (let i = 1; i < total.games.length; i++) assert.ok(total.games[i - 1].totalCount >= total.games[i].totalCount, '합계 큰 순');
  if (!(top.globalRating?.count)) assert.equal(top.id, last, '(데모는 글로벌 평가 수가 없어) 회원 평가 2개인 게임이 1위');

  assert.equal((await fetch(`${base}/api/browse/popular?sort=zzz`)).status, 400);
  assert.equal((await fetch(`${base}/api/browse/recent?sort=total`)).status, 400, '정렬은 인기 게임에만');
});

test('인기 게임: 평점 높은 순 — PlayPick(회원 평균)·합계(평가 수만큼 가중한 평균, 평가 합 100개 이상)', async () => {
  const { rankGames } = await import('../server/services/ranking.js');
  const g = (id, global, mine) => ({ id, globalRating: global && { avg: Math.round(global[0] * 10) / 10, exact: global[0], count: global[1] }, userRating: { avg: mine?.[0] ?? null, count: mine?.[1] ?? 0 } });
  const games = [g('a', [4.5, 1000]), g('b', [4.46, 300], [5, 100]), g('c', [4.9, 50]), g('d', null, [5, 3]), g('e', [4.0, 200], [1, 2])];
  const total = rankGames(games, 'rating', 'total');
  assert.deepEqual(total.map((x) => x.id), ['b', 'a', 'e'], 'b: (4.46×300+5×100)/400=4.595 > a 4.5, c·d는 평가 100개 미만이라 뺌');
  assert.equal(total[0].totalRating.count, 400);
  assert.equal(total[0].totalRating.avg, 4.6);
  assert.equal(total[2].totalRating.avg, Math.round(((4.0 * 200 + 1 * 2) / 202) * 10) / 10);
  assert.deepEqual(rankGames(games, 'rating', 'playpick').map((x) => x.id), ['b', 'd', 'e'], '회원 평균 높은 순, 같으면 평가 많은 순');
  assert.deepEqual(rankGames(games, 'count', 'playpick').map((x) => x.id), ['b', 'd', 'e']);
  assert.deepEqual(rankGames(games, 'count', 'total').map((x) => [x.id, x.totalCount]), [['a', 1000], ['b', 400], ['e', 202], ['c', 50], ['d', 3]]);

  // API: 평점 높은 순 PlayPick은 회원 평균 순, 잘못된 기준은 400
  const pp = await list('?by=rating&sort=playpick');
  const avgs = pp.games.map((x) => x.userRating.avg);
  assert.ok(avgs.length >= 2);
  assert.deepEqual(avgs, [...avgs].sort((p, q) => q - p));
  assert.equal((await fetch(`${base}/api/browse/popular?by=zzz`)).status, 400);
  assert.equal((await fetch(`${base}/api/browse/recent?by=rating`)).status, 400);
});

test('추천 목록 정렬: 추천순 그대로 · 평가 많은/적은 순 · 평점 높은/낮은 순(평가 50개 이상 먼저, 평점 없으면 맨 뒤)', async () => {
  const { sortResults, compareByOrder, combinedRating } = await import('../server/services/ranking.js');
  const r = (id, global, mine, matched = 3) => ({
    game: { id, globalRating: global && { avg: global[0], count: global[1] }, userRating: { avg: mine?.[0] ?? null, count: mine?.[1] ?? 0 } },
    evaluation: { matchedCount: matched, mismatchCount: 3 - matched },
  });
  const items = [r('few', [4.9, 30]), r('none', null), r('big', [4.2, 5000]), r('best', [4.6, 200], [5, 2]), r('mid', [4.4, 80])];
  assert.deepEqual(sortResults(items, 'match'), items, '추천순은 그대로');
  assert.deepEqual(sortResults(items, 'count').map((x) => x.game.id), ['big', 'best', 'mid', 'few', 'none']);
  assert.deepEqual(sortResults(items, 'rating').map((x) => x.game.id), ['best', 'mid', 'big', 'few', 'none']);
  // 낮은 순·적은 순: 평점은 평가 50개 이상을 낮은 순으로 먼저(나머지는 평가 많은 순), 평가 적은 순은 평가 없는 게임 맨 뒤
  assert.deepEqual(sortResults(items, 'rating_asc').map((x) => x.game.id), ['big', 'mid', 'best', 'few', 'none']);
  assert.deepEqual(sortResults(items, 'count_asc').map((x) => x.game.id), ['few', 'mid', 'best', 'big', 'none']);
  assert.equal(Math.round(combinedRating(items[3].game) * 1000) / 1000, Math.round(((4.6 * 200 + 5 * 2) / 202) * 1000) / 1000);
  assert.equal(compareByOrder(items[0].game, items[1].game, 'match'), 0);
  // 비슷한 게임: 맞는 조건 수가 먼저
  const partial = [r('a', [4.9, 900], null, 1), r('b', [3.0, 60], null, 2)];
  assert.deepEqual(sortResults(partial, 'rating', { byMatch: true }).map((x) => x.game.id), ['b', 'a']);

  // API: 잘못된 정렬은 400, 정렬하면 응답에 order (데모 = 후보 목록 방식)
  assert.equal((await fetch(`${base}/api/recommendations?platforms=pc&order=zzz`)).status, 400);
  const body = await (await fetch(`${base}/api/recommendations?platforms=pc&order=count`)).json();
  assert.equal(body.order, 'count');
  const counts = body.fullMatches.map((x) => (x.game.globalRating?.count ?? 0) + (x.game.userRating?.count ?? 0));
  assert.deepEqual(counts, [...counts].sort((p, q) => q - p));
  const asc = await (await fetch(`${base}/api/recommendations?platforms=pc&order=count_asc`)).json();
  assert.equal(asc.order, 'count_asc');
  const ascCounts = asc.fullMatches.map((x) => (x.game.globalRating?.count ?? 0) + (x.game.userRating?.count ?? 0)).filter((n) => n > 0);
  assert.deepEqual(ascCounts, [...ascCounts].sort((p, q) => p - q));
});
