import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { GUIDE_SAMPLE } from './fixtures.js';

let server, base;
const start = async (config) => {
  const s = createApp(config);
  await new Promise((r) => s.listen(0, r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
};

before(async () => ({ s: server, base } = await start({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' })));
after(() => server.close());

test('GET /api/options', async () => {
  const body = await (await fetch(`${base}/api/options`)).json();
  assert.equal(body.meta.isDemo, true);
  assert.equal(body.players.length, 5);
  assert.ok(body.platforms.length && body.genres.length);
});

test('GET /api/recommendations: 결과 + 조건 검증', async () => {
  const r = await fetch(`${base}/api/recommendations?players=2&platforms=pc&genres=rpg`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.fullMatches.length > 0);
  assert.equal((await fetch(`${base}/api/recommendations`)).status, 400);
  assert.equal((await fetch(`${base}/api/recommendations?genres=zzz`)).status, 400);
});

test('결과 없음: 200 + 빈 배열', async () => {
  const body = await (await fetch(`${base}/api/recommendations?players=5&platforms=arcade&genres=sports`)).json();
  // 아케이드·스포츠·5인 이상 조건은 데모 데이터에서 일부 일치만 있을 수 있음
  assert.ok(Array.isArray(body.fullMatches));
  assert.equal(body.fullMatches.length, 0);
});

test('GET /api/games/:id 및 404', async () => {
  const body = await (await fetch(`${base}/api/games/demo-02`)).json();
  assert.equal(body.game.title, '던전 동맹');
  assert.equal((await fetch(`${base}/api/games/none`)).status, 404);
});

test('live 모드: 게임위 API 응답으로 추천·상세 동작, 인원수는 정보 없음', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => GUIDE_SAMPLE });
  // 샘플 게임은 AI 데이터 파일에 없어 상태 '모름' → 기본 규칙이면 숨겨지므로 이 테스트에서는 끔
  const s = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:', hideUnknownGrac: false }, { fetchImpl });
  await new Promise((r) => s.listen(0, r));
  const b = `http://127.0.0.1:${s.address().port}`;
  try {
    const body = await (await fetch(`${b}/api/recommendations?players=2&platforms=pc&genres=action`)).json();
    assert.equal(body.meta.isDemo, false);
    assert.equal(body.fullMatches.length, 0, '인원 정보가 없으므로 전체 일치 불가');
    const [r] = body.partialMatches;
    assert.equal(r.game.title, '게임물명2');
    assert.deepEqual(r.evaluation.checks.map((c) => c.status), ['unknown', 'match', 'match']);
    const d = await (await fetch(`${b}/api/games/grac-CC-NM-230601-xxx`)).json();
    assert.equal(d.game.rating, '청소년이용불가');
  } finally {
    s.close();
  }
});

test('live 모드: 게임위 API 오류는 오류 응답으로 전달(데모로 대체하지 않음)', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  const s = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:' }, { fetchImpl });
  await new Promise((r) => s.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/recommendations?players=2`);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error.code, 'UPSTREAM_NETWORK');
  } finally {
    s.close();
  }
});

test('GET /api/featured, /api/search (데모)', async () => {
  const f = await (await fetch(`${base}/api/featured`)).json();
  assert.ok(f.games.length > 0);
  assert.ok(f.slideCount > 0);
  assert.equal(f.meta.translation, false);
  const s1 = await (await fetch(`${base}/api/search?q=${encodeURIComponent('던전')}`)).json();
  assert.deepEqual(s1.games.map((g) => g.id), ['demo-02']);
  assert.equal((await fetch(`${base}/api/search?q=`)).status, 400);
});

test('GET /api/featured: 홈 인기 순위는 인기순 앞 6개 그대로(앞을 슬라이드로 건너뛰지 않음), 슬라이드는 그다음 5개', async () => {
  const list = Array.from({ length: 14 }, (_, i) => ({ id: `igdb-${i + 1}`, title: `게임 ${i + 1}`, source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, stores: [], imageUrl: null, altNames: [], globalRating: { avg: 4, count: 1000 - i } }));
  const catalog = { meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] }, featured: async () => ({ games: list, warnings: [] }), getGame: async () => null };
  const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };
  const s = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { catalog, partySize });
  await new Promise((r) => s.listen(0, r));
  try {
    const f = await (await fetch(`http://127.0.0.1:${s.address().port}/api/featured`)).json();
    assert.equal(f.popularCount, 6);
    assert.equal(f.slideCount, 5);
    assert.deepEqual(f.games.map((g) => g.id), list.map((g) => g.id), '순서 그대로');
  } finally {
    s.close();
  }
});
