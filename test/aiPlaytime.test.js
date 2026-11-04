// 상세 화면 AI 플레이 시간: 로그인한 회원만, 한 게임 한 번만 묻고 DB에 저장
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { buildPlaytimePrompt } from '../server/services/aiPlaytime.js';
import { createRawgPlaytime } from '../server/services/rawgPlaytime.js';

const game = (id, title, extra = {}) => ({ id, title, source: 'IGDB', platforms: ['pc'], genres: ['rpg'], players: null, stores: [], imageUrl: null, altNames: [], ...extra });
const GAMES = {
  'igdb-1': game('igdb-1', 'Long Quest'),
  'igdb-2': game('igdb-2', 'Unknown Indie'),
  'igdb-3': game('igdb-3', 'Has Rawg'),
  'igdb-4': game('igdb-4', 'Fourth'),
  'igdb-5': game('igdb-5', 'Fifth'),
  'igdb-6': game('igdb-6', 'Broken'),
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  browse: async () => ({ games: [], hasMore: false }),
  search: async () => ({ games: [], warnings: [] }),
};
const partySize = { configured: false, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

// 가짜 Gemini: 이름에 따라 답, 부른 횟수 기록
const asked = [];
const fetchImpl = async (url, init) => {
  if (!String(url).includes('generativelanguage')) throw new Error(`예상 못 한 호출 ${url}`);
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  asked.push(prompt);
  if (prompt.includes('Broken')) return { ok: false, status: 503, json: async () => ({}) };
  const hours = prompt.includes('Long Quest') ? 40 : null;
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ hours }) }] } }] }) };
};

let server, base;
before(async () => {
  const rawgPlaytime = createRawgPlaytime(null, { entries: { 'igdb-3': { hours: 12, url: 'https://rawg.io/games/has-rawg', name: 'Has Rawg' } } });
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', appStore: {}, aiPlaytime: { apiKey: 'k', live: true, dailyLimit: 3 } },
    { catalog, partySize, rawgPlaytime, fetchImpl, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
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
    return { status: res.status, body: await res.json() };
  };
}

test('프롬프트: 게임 이름과 모르면 null 지시', () => {
  const p = buildPlaytimePrompt(game('igdb-9', '롱 퀘스트', { originalTitle: 'Long Quest', firstYear: 2020 }));
  assert.match(p, /"name":"Long Quest"/);
  assert.match(p, /"year":2020/);
  assert.match(p, /return null/);
});

test('로그인 안 하면 AI를 부르지 않음, 상세에는 물어볼 수 있다고만 알려 줌', async () => {
  const anon = client();
  const d = await anon('GET', '/api/games/igdb-1');
  assert.equal(d.body.game.playtime, null);
  assert.equal(d.body.game.playtimeAsk, true);
  assert.equal((await anon('POST', '/api/games/igdb-1/playtime', {})).status, 401);
  assert.equal(asked.length, 0);
});

test('로그인한 회원: 처음 한 번만 AI에게 묻고 저장, 다음부터는 상세에 바로 나옴', async () => {
  const u = client();
  await u('POST', '/api/auth/signup', { loginId: 'timer1', password: 'secret123', nickname: 'timer1', email: 't1@example.com' });
  const r = await u('POST', '/api/games/igdb-1/playtime', {});
  assert.deepEqual(r.body, { playtime: { hours: 40, source: 'ai' }, status: 'asked' });
  assert.equal(asked.length, 1);

  // 다른 사람(로그인 안 함)이 열어도 저장된 값이 바로, 더 묻지 않음
  const d = await client()('GET', '/api/games/igdb-1');
  assert.deepEqual(d.body.game.playtime, { hours: 40, source: 'ai' });
  assert.equal(d.body.game.playtimeAsk, false);
  assert.equal((await u('POST', '/api/games/igdb-1/playtime', {})).body.status, 'known');
  assert.equal(asked.length, 1);
});

test('AI가 모른다고 하면 정보 없음으로 저장, 다시 묻지 않음', async () => {
  const u = client();
  await u('POST', '/api/auth/signup', { loginId: 'timer2', password: 'secret123', nickname: 'timer2', email: 't2@example.com' });
  const before = asked.length;
  assert.deepEqual((await u('POST', '/api/games/igdb-2/playtime', {})).body, { playtime: null, status: 'asked' });
  assert.equal((await u('POST', '/api/games/igdb-2/playtime', {})).body.status, 'cached');
  const d = await u('GET', '/api/games/igdb-2');
  assert.equal(d.body.game.playtime, null);
  assert.equal(d.body.game.playtimeAsk, false, '이미 물어봤으므로 화면도 다시 묻지 않음');
  assert.equal(asked.length, before + 1);
});

test('이미 플레이 시간이 있는 게임(RAWG 파일)은 AI를 부르지 않음', async () => {
  const u = client();
  await u('POST', '/api/auth/signup', { loginId: 'timer3', password: 'secret123', nickname: 'timer3', email: 't3@example.com' });
  const before = asked.length;
  const d = await u('GET', '/api/games/igdb-3');
  assert.equal(d.body.game.playtime.source, 'rawg');
  assert.equal(d.body.game.playtimeAsk, false);
  assert.equal((await u('POST', '/api/games/igdb-3/playtime', {})).body.status, 'known');
  assert.equal(asked.length, before);
});

test('AI 오류는 저장하지 않고 나중에 다시 시도, 하루 상한을 넘으면 묻지 않음', async () => {
  const u = client();
  await u('POST', '/api/auth/signup', { loginId: 'timer4', password: 'secret123', nickname: 'timer4', email: 't4@example.com' });
  assert.deepEqual((await u('POST', '/api/games/igdb-6/playtime', {})).body, { playtime: null, status: 'error' });
  assert.equal((await u('GET', '/api/games/igdb-6')).body.game.playtimeAsk, true, '오류는 저장 안 함 → 다음에 다시');
  // 지금까지 저장 2건(igdb-1, igdb-2), 상한 3 → 1건 더 되고 그다음은 limit
  assert.equal((await u('POST', '/api/games/igdb-4/playtime', {})).body.status, 'asked');
  const before = asked.length;
  assert.deepEqual((await u('POST', '/api/games/igdb-5/playtime', {})).body, { playtime: null, status: 'limit' });
  assert.equal(asked.length, before);
});

test('데모 게임·없는 게임', async () => {
  const u = client();
  await u('POST', '/api/auth/signup', { loginId: 'timer5', password: 'secret123', nickname: 'timer5', email: 't5@example.com' });
  assert.equal((await u('POST', '/api/games/igdb-999/playtime', {})).status, 404);
});
