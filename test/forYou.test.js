// 나를 위한 추천: 취향표·점수·이유 + /api/me/for-you
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { buildProfile, rankForYou, ratingSignal, topGenres } from '../server/services/forYou.js';

const game = (id, genres, { platforms = ['pc'], players = [1, 4], count = 100, title } = {}) => ({
  id, title: title ?? `게임 ${id}`, source: 'IGDB', platforms, genres, players: null,
  recommendedPlayers: players ? { min: players[0], max: players[1], source: 'igdb' } : null,
  stores: [], imageUrl: null, altNames: [], globalRating: { avg: 4, count },
});

test('별점 → 활동 종류', () => {
  assert.equal(ratingSignal(5), 'love');
  assert.equal(ratingSignal(3), null);
  assert.equal(ratingSignal(1), 'dislike');
});

test('취향표: 별점 높게 준 장르가 가장 위, 싫어한 장르는 빠짐, 같은 게임은 가장 강한 활동 하나만', () => {
  const p = buildProfile([
    { game: game('igdb-1', ['puzzle']), kind: 'love' },
    { game: game('igdb-1', ['puzzle']), kind: 'view' },
    { game: game('igdb-2', ['action']), kind: 'wish' },
    { game: game('igdb-3', ['horror']), kind: 'dislike' },
  ]);
  assert.equal(p.signalCount, 3);
  assert.deepEqual(topGenres(p), ['puzzle', 'action']);
  assert.equal(p.genres.has('horror'), false);
  assert.equal(p.togetherShare, 1, '좋아한 게임이 모두 여럿이 하는 게임');
});

test('점수: 취향 장르 > 다른 장르, 본 게임·안 맞는 플랫폼은 빠짐, 여럿이 하는 취향이면 협동 게임 먼저, 이유 한 줄', () => {
  const p = buildProfile([
    { game: game('igdb-1', ['puzzle'], { title: '포털 2' }), kind: 'love' },
    { game: game('igdb-2', ['puzzle', 'action']), kind: 'wish' },
  ]);
  const list = rankForYou(
    [
      game('igdb-1', ['puzzle']), // 이미 별점 준 게임
      game('igdb-10', ['action'], { count: 50000 }), // 인기는 많지만 장르 몫이 작음
      game('igdb-11', ['puzzle'], { players: [1, 1], count: 100 }),
      game('igdb-12', ['puzzle'], { players: [2, 4], count: 100 }),
      game('igdb-13', ['puzzle'], { platforms: ['switch'] }), // 내 플랫폼 아님
      game('igdb-14', ['sports']), // 취향 장르와 안 겹침
    ],
    p,
    { genreLabel: (g) => ({ puzzle: '퍼즐' })[g] ?? g },
  );
  assert.deepEqual(list.map((g) => g.id), ['igdb-12', 'igdb-11', 'igdb-10']);
  assert.equal(list[0].forYouReason, '별점을 높게 준 「포털 2」처럼 퍼즐 · 2~4명');
  assert.match(list[1].forYouReason, / · 혼자$/);
});

// ── API ──
const NATIVE = {
  'igdb-1': game('igdb-1', ['puzzle'], { title: '좋아한 퍼즐' }),
  'igdb-2': game('igdb-2', ['puzzle'], { count: 900 }),
  'igdb-3': game('igdb-3', ['action'], { count: 5000 }),
  'igdb-4': game('igdb-4', ['puzzle'], { count: 300 }),
};
const browseCalls = [];
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => NATIVE[id] ?? null,
  getMany: async (ids) => ids.map((id) => NATIVE[id]).filter(Boolean),
  browse: async (kind, { genre, offset = 0 } = {}) => {
    browseCalls.push({ genre, offset });
    return { games: offset ? [] : Object.values(NATIVE).filter((g) => !genre || g.genres.includes(genre)), hasMore: false };
  },
};
const partySize = { configured: false, size: 0, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { catalog, partySize, mailer: { configured: false, devLog: false, send: async () => {} } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
}

test('GET /api/me/for-you: 로그인 필요, 활동 없으면 안내 + 인기 게임, 별점 준 장르 위주로 이유와 함께', async () => {
  assert.equal((await fetch(`${base}/api/me/for-you`)).status, 401);
  const me = client();
  await me('POST', '/api/auth/signup', { loginId: 'foryou1', password: 'secret123', nickname: '취향이', email: 'fy@example.com' });
  const empty = (await me('GET', '/api/me/for-you')).body;
  assert.equal(empty.needMore, true);
  assert.equal(empty.games[0].id, 'igdb-3', '활동이 없으면 평가 많은 게임부터');

  await me('PUT', '/api/games/igdb-1/reviews/mine', { rating: 5, content: '최고' });
  const r = (await me('GET', '/api/me/for-you')).body;
  assert.deepEqual(r.topGenres, ['퍼즐']);
  assert.deepEqual(r.games.map((g) => g.id), ['igdb-2', 'igdb-4'], '퍼즐만, 별점 준 게임은 빼고, 평가 많은 순');
  assert.match(r.games[0].forYouReason, /「좋아한 퍼즐」처럼 퍼즐/);
  assert.ok(browseCalls.some((c) => c.genre === 'puzzle'), '취향 장르의 인기 게임을 후보로');
});
