import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSteamTrailers, pickMovie, steamAppId } from '../server/services/steamTrailer.js';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const V = 'https://video.akamai.steamstatic.com/store_trailers/1/2/abc/3';
const movie = (name, extra = {}) => ({ name, thumbnail: 'https://shared.akamai.steamstatic.com/x/movie_600x337.jpg', hls_h264: `${V}/${encodeURIComponent(name)}.m3u8`, ...extra });
const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('steamAppId: 구매처의 Steam 상점 주소에서만 앱 번호', () => {
  assert.equal(steamAppId({ stores: [{ url: 'https://www.gog.com/game/x' }, { url: 'https://store.steampowered.com/app/271590/Grand_Theft_Auto_V/' }] }), '271590');
  assert.equal(steamAppId({ stores: [{ url: 'https://steamcommunity.com/app/620' }] }), null);
  assert.equal(steamAppId({}), null);
});

test('pickMovie: 다른 나라 등급판은 빼고 출시·공식 트레일러 먼저, Steam 영상 서버 주소만', () => {
  assert.equal(pickMovie([movie('GTA Online: Heist (DE USK)'), movie('GTA Online: Heist - PEGI EN')]).hls, `${V}/${encodeURIComponent('GTA Online: Heist - PEGI EN')}.m3u8`);
  assert.match(pickMovie([movie('Teaser'), movie('Official Launch Trailer'), movie('Gameplay')]).hls, /Launch/);
  assert.equal(pickMovie([{ name: 'x', hls_h264: 'https://evil.example/a.m3u8' }]), null, 'Steam 서버가 아니면 버림');
  assert.equal(pickMovie([{ name: 'old', mp4: { max: 'x' } }]), null, 'HLS 없으면 없음');
  assert.equal(pickMovie([]), null);
  assert.equal(pickMovie([movie('a', { thumbnail: 'https://evil.example/t.jpg' })]).poster, null);
});

test('createSteamTrailers: 게임마다 한 번만 묻고 저장, 오류·없음이면 붙이지 않음', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const id = new URL(url).searchParams.get('appids');
    calls.push(id);
    if (id === '3') throw new Error('network');
    if (id === '2') return reply({ 2: { success: true, data: {} } });
    return reply({ [id]: { success: true, data: { movies: [movie('Launch Trailer')] } } });
  };
  const t = createSteamTrailers({ fetchImpl });
  const game = (id, app) => ({ id, stores: app ? [{ url: `https://store.steampowered.com/app/${app}` }] : [] });
  const games = [game('a', 1), game('b', 2), game('c', 3), game('d')];
  const out = await t.attach(games);
  assert.match(out[0].steamTrailer.hls, /Launch/);
  assert.ok(out[0].steamTrailer.poster);
  assert.equal(out[1].steamTrailer, undefined);
  assert.equal(out[2].steamTrailer, undefined);
  assert.equal(out[3].steamTrailer, undefined);
  assert.equal(games[0].steamTrailer, undefined, '원본은 그대로');
  await t.attach(games);
  assert.deepEqual(calls.sort(), ['1', '2', '3'], '두 번째는 저장된 값(오류도 10분 동안)');
});

test('createSteamTrailers: 늦으면 기다리지 않고 그대로, 다음 요청에 붙음', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const t = createSteamTrailers({ fetchImpl: async () => (await gate, reply({ 9: { success: true, data: { movies: [movie('Trailer')] } } })) });
  const games = [{ id: 'x', stores: [{ url: 'https://store.steampowered.com/app/9' }] }];
  const first = await t.attach(games, { waitMs: 20 });
  assert.equal(first[0].steamTrailer, undefined);
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok((await t.attach(games, { waitMs: 20 }))[0].steamTrailer);
});

test('GET /api/featured: Steam 트레일러가 붙어 나감', async () => {
  const steamTrailers = { attach: async (games) => games.map((g, i) => (i === 0 ? { ...g, steamTrailer: { hls: `${V}/m.m3u8`, poster: null } } : g)) };
  const s = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' }, { steamTrailers });
  await new Promise((r) => s.listen(0, r));
  try {
    const body = await (await fetch(`http://127.0.0.1:${s.address().port}/api/featured`)).json();
    assert.equal(body.games[0].steamTrailer.hls, `${V}/m.m3u8`);
    assert.equal(body.games[1].steamTrailer, undefined);
  } finally {
    s.close();
  }
});
