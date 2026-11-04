import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRawgProvider, RAWG_API } from '../server/providers/rawgProvider.js';

const results = (r) => async () => ({ ok: true, status: 200, json: async () => ({ results: r }) });

test('요청 형식: key·search 파라미터, 키 없으면 호출 안 함', async () => {
  let url;
  const p = createRawgProvider({ apiKey: 'K' }, { fetchImpl: async (u) => { url = u; return results([])(); } });
  await p.playtime({ names: ['Stardew Valley', '스타듀 밸리'], releaseDate: '2016-02-26' });
  assert.equal(`${url.origin}${url.pathname}`, `${RAWG_API}/games`);
  assert.equal(url.searchParams.get('key'), 'K');
  assert.equal(url.searchParams.get('search'), 'Stardew Valley', '영문 원제로 검색');
  let called = false;
  assert.equal(await createRawgProvider({}, { fetchImpl: async () => { called = true; } }).playtime({ names: ['x'] }), null);
  assert.equal(called, false);
});

test('같은 게임일 때만: 이름 정규화 일치 + 출시 연도 일치, 0시간은 정보 없음', async () => {
  const data = [
    { name: 'Tomb Raider', slug: 'tomb-raider-1996', released: '1996-10-25', playtime: 9 },
    { name: 'Tomb Raider', slug: 'tomb-raider', released: '2013-03-05', playtime: 13 },
    { name: 'Stardew Valley', slug: 'stardew-valley', released: '2016-02-26', playtime: 0 },
  ];
  const p = createRawgProvider({ apiKey: 'K' }, { fetchImpl: results(data) });
  assert.deepEqual(await p.playtime({ names: ['Tomb Raider'], releaseDate: '2013-03-05' }), { hours: 13, url: 'https://rawg.io/games/tomb-raider', name: 'Tomb Raider' });
  assert.equal((await p.playtime({ names: ['TOMB  RAIDER'], releaseDate: '1996-11-14' })).hours, 9);
  assert.equal(await p.playtime({ names: ['Tomb Raider'], releaseDate: '2020-01-01' }), null, '연도가 2년 이상 다르면 다른 게임');
  assert.equal((await p.playtime({ names: ['Tomb Raider'], releaseDate: '2014-01-28' })).hours, 13, '1년 차이는 허용');
  assert.equal(await p.playtime({ names: ['Stardew Valley'], releaseDate: '2016-02-26' }), null, '0시간 = 정보 없음');
  assert.equal(await p.playtime({ names: ['Tomb Raider: Underworld'] }), null, '이름 다르면 없음');
});

test('캐시: 같은 게임은 다시 호출하지 않음, 오류는 그대로 던짐(상세 화면에서 정보 없음 처리)', async () => {
  let n = 0;
  const p = createRawgProvider({ apiKey: 'K' }, { fetchImpl: async () => { n++; return results([{ name: 'A', slug: 'a', playtime: 3 }])(); } });
  await p.playtime({ names: ['A'] });
  await p.playtime({ names: ['A'] });
  assert.equal(n, 1);
  const bad = createRawgProvider({ apiKey: 'K' }, { fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(bad.playtime({ names: ['A'] }), /401/);
});

test('별칭으로도 연결, 괄호·플랫폼 표기 무시, 최대 2번 검색, 한글 이름으로는 검색 안 함, 못 찾은 이유', async () => {
  const queries = [];
  const fetchImpl = async (u) => {
    const q = u.searchParams.get('search');
    queries.push(q);
    const data = q === "PlayerUnknown's Battlegrounds" ? [{ name: "PLAYERUNKNOWN'S BATTLEGROUNDS", slug: 'pubg', released: '2017-12-21', playtime: 40 }] : [{ name: 'Something else', slug: 'x', released: '2017-01-01', playtime: 3 }];
    return { ok: true, status: 200, json: async () => ({ results: data }) };
  };
  const p = createRawgProvider({ apiKey: 'K' }, { fetchImpl });
  const r = await p.playtime({ names: ['PUBG: Battlegrounds', "PlayerUnknown's Battlegrounds", 'PUBG', '배틀그라운드'], releaseDate: '2017-03-23' });
  assert.equal(r.hours, 40);
  assert.deepEqual(queries, ['PUBG: Battlegrounds', "PlayerUnknown's Battlegrounds"]);
  assert.equal(queries.includes('배틀그라운드'), false);
  const d = await p.lookup({ names: ['Nope'], releaseDate: null });
  assert.equal(d.reason, 'NAME');
  assert.match(d.candidates[0], /Something else/);
  assert.equal((await p.lookup({ names: ['배틀그라운드'] })).reason, 'NO_ENGLISH_NAME');
  const p2 = createRawgProvider({ apiKey: 'K' }, { fetchImpl: results([{ name: 'Celeste (Switch)', slug: 'celeste', released: '2018-01-25', playtime: 9 }]) });
  assert.equal((await p2.playtime({ names: ['Celeste'], releaseDate: '2018-01-25' })).hours, 9);
});
