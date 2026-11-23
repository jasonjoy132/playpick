// IGDB·게관위에 없는 Steam 게임: Steam 상세 → 사이트 게임, 검색·상세·추천에 나옴
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { createSteamGames, isFullGame, steamDate, steamToGame } from '../server/services/steamGames.js';

const detail = (data) => ({ success: true, data: { type: 'game', name: '강호 11', is_free: false, release_date: { coming_soon: false, date: '2022년 3월 5일' }, platforms: { windows: true }, genres: [{ id: '3', description: 'RPG' }, { id: '23', description: '인디' }], categories: [{ id: 2, description: '싱글 플레이어' }], header_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1816570/header.jpg', short_description: '<b>무협</b> RPG', publishers: ['Studio'], ...data } });

test('Steam 상세 → 게임: 싱글 플레이만이면 1명, 장르·날짜·무료 여부, 소개의 태그 제거', () => {
  const { game } = steamToGame('1816570', detail(), { englishName: 'Jianghu XI', reviews: 5443 });
  assert.equal(game.id, 'steam-1816570');
  assert.equal(game.source, 'Steam');
  assert.equal(game.originalTitle, 'Jianghu XI');
  assert.deepEqual(game.recommendedPlayers, { min: 1, max: 1, source: 'steam' });
  assert.deepEqual(game.genres, ['rpg']);
  assert.deepEqual(game.platforms, ['pc']);
  assert.equal(game.releaseDate, '2022-03-05');
  assert.deepEqual(game.price, { free: false, source: 'steam' });
  assert.equal(game.summary, '무협 RPG');
  assert.equal(game.stores[0].url, 'https://store.steampowered.com/app/1816570');
  assert.equal(game.imageUrl, game.bannerUrl, '세로 표지 확인 안 됐으면 가로 그림');
});

test('Steam 상세 → 넣지 않음: 프로그램·출시 전·성인 전용, 멀티 기능이면 인원 정보 없음', () => {
  assert.equal(steamToGame('1', detail({ type: 'software' })).skip, 'not-game');
  assert.equal(steamToGame('1', detail({ release_date: { coming_soon: true } })).skip, 'coming-soon');
  assert.equal(steamToGame('1', detail({ content_descriptors: { ids: [1, 5] } })).skip, 'adult', '성적 노출 표시도 뺌');
  assert.equal(steamToGame('1', detail({ name: 'Supermarket Simulator: Prologue' })).skip, 'not-full-game');
  assert.equal(steamToGame('1', detail({ name: 'Hello Neighbor Alpha 2' })).skip, 'not-full-game');
  assert.equal(steamToGame('1', detail({ name: 'Z1 Battle Royale: Test Server' })).skip, 'not-full-game');
  assert.equal(steamToGame('1', detail({ name: 'Alphabet Quest' })).game?.title, 'Alphabet Quest', '단어 일부는 안 걸림');
  assert.equal(steamToGame('1', detail({ genres: [{ id: '57' }, { id: '1' }] })).skip, 'not-game', '유틸리티 장르');
  assert.equal(steamToGame('1', detail({ genres: [{ id: '37' }] })).skip, 'not-game', '무료 플레이 장르뿐');
  assert.equal(steamToGame('1', { success: false }).skip, 'no-data');
  assert.equal(steamToGame('1', detail({ categories: [{ id: 2 }, { id: 38 }] })).game.recommendedPlayers, null);
  assert.equal(steamToGame('1', detail({ header_image: 'https://evil.example/x.jpg' })).game.bannerUrl, null, 'Steam 그림 주소만');
  const sample = steamToGame('1', detail({ name: 'Thief Simulator 3: First Loot', is_free: true })).game;
  assert.equal(isFullGame(sample), false, '무료 맛보기판 부제');
  assert.equal(isFullGame({ ...sample, price: { free: false, source: 'steam' } }), true, '유료면 본편');
  assert.equal(isFullGame({ ...sample, steamAppId: '3982450', title: 'x' }), false, '직접 뺀 게임');
  assert.equal(steamDate('24 Feb, 2022'), '2022-02-24');
  assert.equal(steamDate('곧 출시'), null);
});

test('API: Steam 게임이 검색·상세·추천에 나옴, 파일의 제외 항목은 안 나옴', async () => {
  const { game } = steamToGame('1816570', detail(), { englishName: 'Jianghu XI', reviews: 5443 });
  const steamGames = createSteamGames(null, { entries: { 1816570: { game }, 99: { skip: 'adult' } } });
  const server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' }, { steamGames });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/api/search?q=${encodeURIComponent('jianghu')}`)).json();
    assert.ok(s.games.some((g) => g.id === 'steam-1816570'), '원제로 검색');
    const d = await (await fetch(`${base}/api/games/steam-1816570`)).json();
    assert.equal(d.game.title, '강호 11');
    assert.deepEqual(d.game.price, { free: false, source: 'steam' });
    const r = await (await fetch(`${base}/api/recommendations?players=1&platforms=pc&genres=rpg`)).json();
    const all = [...r.fullMatches, ...r.partialMatches].map((x) => x.game.id);
    assert.ok(all.includes('steam-1816570'), '추천에도');
    assert.equal((await fetch(`${base}/api/games/steam-99`)).status, 404);
  } finally {
    server.close();
  }
});
