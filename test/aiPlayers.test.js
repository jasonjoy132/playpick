// 상세 화면 AI 추천 인원: 추천 인원이 아무 데도 없는 게임만, 로그인한 회원이 열 때 한 번만 묻고 DB에 저장 → 목록·추천에도 반영
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { createPartySize } from '../server/services/partySize.js';
import { buildPlayersPrompt } from '../server/services/aiPlayers.js';

const game = (id, title, extra = {}) => ({ id, title, source: 'IGDB', platforms: ['pc'], genres: ['action'], players: null, recommendedPlayers: null, stores: [], imageUrl: null, altNames: [], ...extra });
const GAMES = {
  'igdb-1': game('igdb-1', 'Party Brawl', { players: { min: 1, max: 4 } }), // AI 2~8 → IGDB 최대 4로 줄임
  'igdb-2': game('igdb-2', 'Unknown Indie'),
  'igdb-3': game('igdb-3', 'Has Coop', { recommendedPlayers: { min: 2, max: 4, source: 'igdb' } }),
  'igdb-4': game('igdb-4', 'File Unknown'), // 파일에서 AI가 '모름'
  'igdb-5': game('igdb-5', 'Fifth'),
  'igdb-6': game('igdb-6', 'Broken'),
  'igdb-7': game('igdb-7', 'Seventh'),
};
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => GAMES[id] ?? null,
  browse: async () => ({ games: [], hasMore: false }),
  search: async () => ({ games: Object.values(GAMES), warnings: [] }),
};

const asked = [];
const fetchImpl = async (url, init) => {
  if (!String(url).includes('generativelanguage')) throw new Error(`예상 못 한 호출 ${url}`);
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  asked.push(prompt);
  if (prompt.includes('Broken')) return { ok: false, status: 503, json: async () => ({}) };
  const ans = prompt.includes('Party Brawl') ? { min: 2, max: 8 } : prompt.includes('Fifth') ? { min: 1, max: 2 } : { min: null, max: null };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }] }) };
};

let server, base, tmp;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-aiplayers-'));
  const dataFile = path.join(tmp, 'party-size.json');
  fs.writeFileSync(dataFile, JSON.stringify({ 4: { unknown: true, hours: null }, 99: { min: 1, max: 1 } }));
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', appStore: {}, rawg: {}, aiPlayers: { apiKey: 'k', live: true, dailyLimit: 3 }, aiPlaytime: { live: false } },
    { catalog, partySize: createPartySize({ dataFile }), fetchImpl, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
async function member(n) {
  const u = client();
  await u('POST', '/api/auth/signup', { loginId: `party${n}`, password: 'secret123', nickname: `party${n}`, email: `p${n}@example.com` });
  return u;
}

test('프롬프트: 같이 하는 인원·IGDB 최대 인원·모르면 null', () => {
  const p = buildPlayersPrompt(game('igdb-9', '파티', { originalTitle: 'Party', firstYear: 2021, players: { min: 1, max: 4 } }));
  assert.match(p, /"name":"Party"/);
  assert.match(p, /"igdbMaxPlayers":4/);
  assert.match(p, /TOGETHER/);
  assert.match(p, /return null/);
});

test('로그인 안 하면 AI를 부르지 않음, 상세에는 물어볼 수 있다고만 알려 줌', async () => {
  const anon = client();
  const d = await anon('GET', '/api/games/igdb-1');
  assert.equal(d.body.game.recommendedPlayers, null);
  assert.equal(d.body.game.playersAsk, true);
  assert.equal((await anon('POST', '/api/games/igdb-1/players', {})).status, 401);
  assert.equal(asked.length, 0);
});

test('로그인한 회원: 처음 한 번만 묻고 저장(IGDB 최대 인원 이하로) → 상세·목록에 AI 추정으로', async () => {
  const u = await member(1);
  const r = await u('POST', '/api/games/igdb-1/players', {});
  assert.deepEqual(r.body, { players: { min: 2, max: 4, source: 'ai' }, status: 'asked' });
  assert.equal(asked.length, 1);

  const d = await client()('GET', '/api/games/igdb-1');
  assert.deepEqual(d.body.game.recommendedPlayers, { min: 2, max: 4, source: 'ai' });
  assert.equal(d.body.game.playersAsk, false);
  assert.equal((await u('POST', '/api/games/igdb-1/players', {})).body.status, 'known');
  // 목록(검색)에도 반영
  const list = (await client()('GET', '/api/search?q=party')).body.games;
  assert.deepEqual(list.find((g) => g.id === 'igdb-1')?.recommendedPlayers, { min: 2, max: 4, source: 'ai' });
  assert.equal(asked.length, 1);
});

test('AI가 모른다고 하면 정보 없음으로 저장, 다시 묻지 않음', async () => {
  const u = await member(2);
  const before = asked.length;
  assert.deepEqual((await u('POST', '/api/games/igdb-2/players', {})).body, { players: null, status: 'asked' });
  assert.equal((await u('POST', '/api/games/igdb-2/players', {})).body.status, 'cached');
  assert.equal((await u('GET', '/api/games/igdb-2')).body.game.playersAsk, false);
  assert.equal(asked.length, before + 1);
});

test('IGDB에 인원이 있거나 파일에서 이미 모름이면 묻지 않음', async () => {
  const u = await member(3);
  const before = asked.length;
  const coop = (await u('GET', '/api/games/igdb-3')).body.game;
  assert.equal(coop.recommendedPlayers.source, 'igdb');
  assert.equal(coop.playersAsk, false);
  assert.equal((await u('POST', '/api/games/igdb-3/players', {})).body.status, 'known');
  assert.equal((await u('GET', '/api/games/igdb-4')).body.game.playersAsk, false);
  assert.equal((await u('POST', '/api/games/igdb-4/players', {})).body.status, 'none');
  assert.equal(asked.length, before);
});

test('AI 오류는 저장하지 않고 다음에 다시, 하루 상한을 넘으면 묻지 않음', async () => {
  const u = await member(4);
  assert.deepEqual((await u('POST', '/api/games/igdb-6/players', {})).body, { players: null, status: 'error' });
  assert.equal((await u('GET', '/api/games/igdb-6')).body.game.playersAsk, true);
  // 저장 2건(igdb-1, igdb-2), 상한 3 → 1건 더 되고 그다음은 limit
  assert.deepEqual((await u('POST', '/api/games/igdb-5/players', {})).body, { players: { min: 1, max: 2, source: 'ai' }, status: 'asked' });
  const before = asked.length;
  assert.deepEqual((await u('POST', '/api/games/igdb-7/players', {})).body, { players: null, status: 'limit' });
  assert.equal(asked.length, before);
  assert.equal((await u('POST', '/api/games/igdb-999/players', {})).status, 404);
});
