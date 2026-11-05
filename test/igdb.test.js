import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIgdbProvider, playersWhere, derivePlayers, storeFromUrl, igdbToGame, gracRatingFromIgdb, globalRatingFromIgdb, IGDB_TOKEN_URL } from '../server/providers/igdbProvider.js';
import { createCatalog, mergeGames } from '../server/services/catalog.js';
import { parseGracXml } from '../server/providers/gracProvider.js';
import { GUIDE_SAMPLE } from './fixtures.js';

// igdbapi.proto 의 필드 구조를 따른 가짜 응답 (실제 응답 아님)
const IGDB_GAME = {
  id: 101,
  name: 'Test Kitchen',
  summary: 'A co-op cooking game.',
  url: 'https://www.igdb.com/games/test-kitchen',
  first_release_date: 1700000000,
  genres: [{ id: 9, name: 'Simulator' }, { id: 10, name: 'Puzzle' }],
  platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }, { id: 130, name: 'Nintendo Switch' }],
  game_modes: [{ name: 'Single player' }, { name: 'Multiplayer' }, { name: 'Co-operative' }],
  multiplayer_modes: [{ offlinemax: 4, onlinemax: 4, offlinecoopmax: 4 }],
  cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/abc123.jpg' },
  websites: [
    { url: 'https://store.steampowered.com/app/1/', trusted: true },
    { url: 'https://twitter.com/test' },
    { url: 'https://www.nintendo.com/store/products/test/' },
  ],
  game_localizations: [{ name: '테스트 키친', region: { name: 'Korea' } }],
  involved_companies: [{ publisher: true, company: { name: 'Test Pub' } }],
};

const cfg = { clientId: 'CID', clientSecret: 'TOP-SECRET' };

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) if (String(url).includes(match)) return handler(url, init, calls);
    throw new Error(`unexpected ${url}`);
  };
  fn.calls = calls;
  return fn;
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const tokenOk = () => json({ access_token: 'TOKEN-1', expires_in: 5000, token_type: 'bearer' });

test('플레이 인원 도출 규칙', () => {
  assert.deepEqual(derivePlayers(IGDB_GAME), { min: 1, max: 4 });
  assert.deepEqual(derivePlayers({ game_modes: [{ name: 'Single player' }] }), { min: 1, max: 1 });
  assert.deepEqual(derivePlayers({ game_modes: [{ name: 'Multiplayer' }], multiplayer_modes: [{ onlinemax: 10 }] }), { min: 2, max: 10 });
  assert.equal(derivePlayers({ game_modes: [{ name: 'Single player' }, { name: 'Multiplayer' }] }), null, '최대 인원 근거 없음');
  assert.equal(derivePlayers({}), null);
});

test('구매처: 스토어 주소만 인정', () => {
  assert.equal(storeFromUrl('https://store.steampowered.com/app/1/').name, 'Steam');
  assert.equal(storeFromUrl('https://play.google.com/store/apps/details?id=x').name, 'Google Play');
  assert.equal(storeFromUrl('https://twitter.com/x'), null);
  assert.equal(storeFromUrl('javascript:alert(1)'), null);
  assert.equal(storeFromUrl('https://evil-steampowered.com/'), null);
});

test('IGDB 게임 → 플레이픽 모델', () => {
  const g = igdbToGame(IGDB_GAME);
  assert.equal(g.id, 'igdb-101');
  assert.equal(g.title, '테스트 키친');
  assert.equal(g.originalTitle, 'Test Kitchen');
  assert.deepEqual(g.platforms, ['pc', 'console']);
  assert.deepEqual(g.genres, ['simulation', 'puzzle']);
  assert.deepEqual(g.players, { min: 1, max: 4 });
  assert.equal(g.imageUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg');
  assert.deepEqual(g.stores.map((s) => s.name), ['Steam', 'Nintendo eShop']);
  assert.equal(g.domesticRating, false);
  assert.equal(g.publisher, 'Test Pub');
  assert.equal(g.releaseDate, '2023-11-14');
});

test('인증: 토큰 요청 형식, 헤더, 토큰 재사용, 401 시 1회 재발급', async () => {
  let gamesCalls = 0;
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/games', () => (++gamesCalls === 2 ? json({}, 401) : json([IGDB_GAME]))],
  ]);
  const p = createIgdbProvider(cfg, { fetchImpl });
  await p.getGame('igdb-101');
  await p.getGame('igdb-101'); // 401 → 재발급 → 재시도
  const tokenCalls = fetchImpl.calls.filter((c) => c.url === IGDB_TOKEN_URL);
  assert.equal(tokenCalls.length, 2);
  const form = tokenCalls[0].init.body;
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('client_id'), 'CID');
  const g = fetchImpl.calls.find((c) => c.url.endsWith('/v4/games'));
  assert.equal(g.init.headers['Client-ID'], 'CID');
  assert.equal(g.init.headers.Authorization, 'Bearer TOKEN-1');
  assert.match(g.init.body, /where id = 101/);
});

test('오류: 인증 실패·한도 초과, 메시지에 비밀값 없음, 미설정', async () => {
  const bad = createIgdbProvider(cfg, { fetchImpl: mockFetch([[IGDB_TOKEN_URL, () => json({ message: 'invalid client secret' }, 403)]]) });
  await assert.rejects(bad.getGame('igdb-1'), (e) => e.code === 'IGDB_AUTH' && !e.message.includes('TOP-SECRET'));
  const limited = createIgdbProvider(cfg, { fetchImpl: mockFetch([[IGDB_TOKEN_URL, tokenOk], ['/v4/', () => json([], 429)]]) });
  await assert.rejects(limited.getGame('igdb-1'), { code: 'IGDB_RATE_LIMIT' });
  await assert.rejects(createIgdbProvider({}).getGame('igdb-1'), { code: 'IGDB_NOT_CONFIGURED' });
});

test('조건 검색: 실제 목록에서 찾은 장르·플랫폼 id로 where 구성', async () => {
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/genres', () => json([{ id: 9, name: 'Simulator' }, { id: 12, name: 'Role-playing (RPG)' }])],
    ['/v4/platforms', () => json([{ id: 6, name: 'PC (Microsoft Windows)' }, { id: 14, name: 'Mac' }])],
    ['/v4/games', () => json([IGDB_GAME])],
  ]);
  const p = createIgdbProvider(cfg, { fetchImpl });
  const games = await p.searchByCriteria({ players: 2, platforms: ['pc'], genres: ['rpg', 'simulation'] });
  assert.equal(games.length, 1, '두 쿼리 결과의 같은 게임은 하나로');
  const gameCalls = fetchImpl.calls.filter((c) => c.url.endsWith('/v4/games'));
  assert.equal(gameCalls.length, 2, '2명 이상이면 인원 정보 있는 게임도 추가 조회');
  assert.match(gameCalls[0].init.body, /limit 300;/);
  assert.match(gameCalls[1].init.body, /multiplayer_modes != null.*limit 200;/);
  const body = gameCalls[0].init.body;
  assert.match(body, /genres = \(12,9\)|genres = \(9,12\)/);
  assert.match(body, /platforms = \(6,14\)/);
  assert.match(body, /version_parent = null/);
  await p.searchByCriteria({ players: 2, platforms: ['pc'], genres: ['rpg', 'simulation'] });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith('/v4/games')).length, 2, '캐시');
  await p.searchByCriteria({ players: 1, platforms: ['pc'], genres: ['rpg', 'simulation'] });
  assert.equal(fetchImpl.calls.filter((c) => c.url.endsWith('/v4/games')).length, 3, '혼자면 인기 게임 쿼리 1번만');
});

test('IGDB의 한국(GRAC) 등급 추출', () => {
  assert.equal(gracRatingFromIgdb({ age_ratings: [{ organization: { name: 'GRAC' }, rating_category: { rating: 'Fifteen' } }] }), '15세이용가');
  assert.equal(gracRatingFromIgdb({ age_ratings: [{ organization: { name: 'ESRB' }, rating_category: { rating: 'M' } }] }), null);
  assert.equal(gracRatingFromIgdb({ age_ratings: [{ organization: { name: 'GRAC' }, rating_category: { rating: 'Something' } }] }), 'Something');
  assert.equal(igdbToGame(IGDB_GAME).domesticRating, false);
});

test('합치기(IGDB 기준): 같은 게임은 IGDB 정보 유지 + 게임위 등급 보완, IGDB에 없는 게임위 게임은 추가', () => {
  const gracSame = { id: 'grac-1', title: '테스트 키친', rating: '전체이용가', ratingNo: 'CC-1', ratingDate: '2024-01-01', players: null, imageUrl: null, stores: [], source: '게임물관리위원회', summary: '게임위 개요' };
  const gracOnly = { id: 'grac-2', title: '국내 전용 게임', rating: '12세이용가', ratingNo: 'CC-2', players: null, imageUrl: null, stores: [], source: '게임물관리위원회' };
  const other = { ...IGDB_GAME, id: 202, name: 'Other Game', game_localizations: [] };
  const out = mergeGames([igdbToGame(IGDB_GAME), igdbToGame(other)], [gracSame, gracOnly]);
  assert.deepEqual(out.map((g) => g.id), ['igdb-101', 'igdb-202', 'grac-2']);
  const merged = out[0];
  assert.equal(merged.source, 'IGDB');
  assert.equal(merged.summary, 'A co-op cooking game.', 'IGDB 정보 유지');
  assert.deepEqual(merged.players, { min: 1, max: 4 });
  assert.equal(merged.rating, '전체이용가');
  assert.equal(merged.ratingNo, 'CC-1');
  assert.equal(merged.ratingSource, '게임물관리위원회');
  assert.equal(merged.domesticRating, true);
  assert.equal(out[1].domesticRating, false);
  assert.equal(out[2].domesticRating, true);
  assert.equal(out[0].matchNames, undefined);
});

test('live 카탈로그: 추천은 IGDB만(실패·미설정 시 게임위로 대체), 둘 다 실패하면 오류', async () => {
  const gracOk = { label: '게임물관리위원회', listGames: async () => parseGracXml(GUIDE_SAMPLE).games, searchByTitle: async () => [] };
  const gracBad = { label: '게임물관리위원회', listGames: async () => { throw Object.assign(new Error('게임위 오류'), { code: 'UPSTREAM_NETWORK' }); } };
  const igdbOk = { label: 'IGDB', configured: true, searchByCriteria: async () => [igdbToGame(IGDB_GAME)] };
  const igdbBad = { label: 'IGDB', configured: true, searchByCriteria: async () => { throw new Error('IGDB 오류'); } };
  const kr = { configured: false, enrich: async (g) => g };
  const live = { dataSource: 'live', krGameDb: {} };

  let r = await createCatalog(live, { grac: gracOk, igdb: igdbOk, kr }).listGames();
  assert.deepEqual(r.games.map((g) => g.source), ['IGDB'], '게임위 전용 게임은 추천에서 제외');
  assert.deepEqual(r.warnings, []);
  r = await createCatalog(live, { grac: gracOk, igdb: igdbBad, kr }).listGames();
  assert.deepEqual(r.games.map((g) => g.title), ['게임물명2']);
  assert.match(r.warnings[0], /IGDB 데이터를 불러오지 못해/);
  r = await createCatalog(live, { grac: gracOk, igdb: { label: 'IGDB', configured: false }, kr }).listGames();
  assert.match(r.warnings[0], /IGDB 설정이 없어/);
  await assert.rejects(createCatalog(live, { grac: gracBad, igdb: igdbBad, kr }).listGames());
  assert.deepEqual(createCatalog(live, { grac: gracOk, igdb: igdbOk, kr }).meta.sources, ['IGDB', '게임물관리위원회']);
});

test('검색: IGDB 결과가 있으면 IGDB만(게임위 결과는 보여 주지 않음), IGDB 결과가 없으면 게임위', async () => {
  const pubg = { ...IGDB_GAME, id: 27789, name: 'PUBG: Battlegrounds', game_localizations: [], alternative_names: [{ name: '배틀그라운드' }] };
  const gracEntry = { id: 'grac-B1', title: '배틀그라운드', platforms: ['pc'], ratingNo: 'B1', stores: [], source: '게임물관리위원회' };
  const kr = { configured: false, enrich: async (g) => g };
  const live = { dataSource: 'live', krGameDb: {} };
  const cat = (igdbRes, gracRes) =>
    createCatalog(live, { kr, igdb: { label: 'IGDB', configured: true, searchByTitle: async () => igdbRes }, grac: { label: '게임물관리위원회', searchByTitle: async () => gracRes } });
  let r = await cat([igdbToGame(pubg)], [gracEntry]).search('배틀그라운드');
  assert.deepEqual(r.games.map((g) => g.id), ['igdb-27789'], '같은 게임이 두 번 나오지 않음');
  assert.equal(r.gracOnlyCount, undefined);
  r = await cat([], [gracEntry]).search('국내전용');
  assert.deepEqual(r.games.map((g) => g.id), ['grac-B1'], 'IGDB에 없으면 게임위 결과 바로 표시');
});

test('검색: IGDB가 이름만 비슷한 엉뚱한 게임만 돌려주면 게임위 결과를 먼저 (로스트아크 사례)', async () => {
  const unrelated = { ...IGDB_GAME, id: 1, name: 'Lost Planet', game_localizations: [], alternative_names: [] };
  const lostArkIgdb = { ...IGDB_GAME, id: 2, name: 'Lost Ark', game_localizations: [{ name: '로스트아크', region: { name: 'Korea' } }] };
  const gracLA = { id: 'grac-LA', title: '로스트아크', platforms: ['pc'], ratingNo: 'LA', stores: [], source: '게임물관리위원회' };
  const kr = { configured: false, enrich: async (g) => g };
  const cat = (igdbRes) => createCatalog({ dataSource: 'live', krGameDb: {} }, { kr, igdb: { label: 'IGDB', configured: true, searchByTitle: async () => igdbRes }, grac: { label: '게임물관리위원회', searchByTitle: async () => [gracLA] } });
  let r = await cat([igdbToGame(unrelated)]).search('로스트아크');
  assert.deepEqual(r.games.map((g) => g.id), ['grac-LA', 'igdb-1'], '게임위 로스트아크가 숨지 않음');
  r = await cat([igdbToGame(lostArkIgdb), igdbToGame(unrelated)]).search('로스트아크');
  assert.deepEqual(r.games.map((g) => g.id), ['igdb-2', 'igdb-1'], 'IGDB에 로스트아크(한국어명)가 있으면 IGDB만');
  assert.equal(r.games[0].ratingNo, 'LA', '게임위 등급은 IGDB 게임에 보완');
  r = await cat([igdbToGame(lostArkIgdb)]).search('lost ark');
  assert.deepEqual(r.games.map((g) => g.id), ['igdb-2']);
});

test('상세(IGDB 게임): 게임위 제목 검색으로 국내 등급 보완, 게임위 실패해도 IGDB 정보 표시', async () => {
  const igdb = { label: 'IGDB', configured: true, getGame: async () => igdbToGame(IGDB_GAME) };
  const kr = { configured: false, enrich: async (g) => g };
  const live = { dataSource: 'live', krGameDb: {} };
  const searched = [];
  const grac = { label: '게임물관리위원회', searchByTitle: async (t) => { searched.push(t); return t === '테스트 키친' ? [{ id: 'grac-9', title: '테스트 키친', rating: '전체이용가', ratingNo: 'CC-9' }] : []; } };
  const g = await createCatalog(live, { grac, igdb, kr }).getGame('igdb-101');
  assert.deepEqual(searched.sort(), ['Test Kitchen', '테스트 키친'].sort());
  assert.equal(g.rating, '전체이용가');
  assert.equal(g.ratingNo, 'CC-9');
  const failing = { label: '게임물관리위원회', searchByTitle: async () => { throw new Error('x'); } };
  const g2 = await createCatalog(live, { grac: failing, igdb, kr }).getGame('igdb-101');
  assert.equal(g2.title, '테스트 키친');
  assert.equal(g2.rating, null);
  assert.ok(g2.warnings.length);
});

test('중복 제거: 같은 게임은 카드 하나 (플랫폼 겹치는 게임위 항목만 등급 보완)', () => {
  const ig = igdbToGame({ ...IGDB_GAME, game_localizations: [{ name: '툼 레이더', region: { name: 'Korea' } }] }); // PC·콘솔
  const mobile = { id: 'grac-m', title: '툼 레이더', platforms: ['mobile'], rating: '청소년이용불가', ratingNo: 'CC-OM-1', ratingDate: '2026-01-22', stores: [], source: '게임물관리위원회' };
  const out = mergeGames([ig], [mobile]);
  assert.deepEqual(out.map((g) => g.id), ['igdb-101'], '게임위 항목을 별도 카드로 만들지 않음');
  assert.ok(!out[0].ratingNo, '플랫폼이 안 겹치면 등급은 붙이지 않음');
  const pc = { ...mobile, id: 'grac-p', platforms: ['pc'], ratingNo: 'CC-PC-1', ratingDate: '2013-03-01', rating: '청소년이용불가' };
  const out2 = mergeGames([ig], [mobile, pc]);
  assert.deepEqual(out2.map((g) => g.id), ['igdb-101']);
  assert.equal(out2[0].ratingNo, 'CC-PC-1', '플랫폼 겹치는 항목의 등급');
});

test('중복 제거: 괄호·플랫폼 표기가 붙은 게임위 제목도 같은 게임으로 판단', () => {
  const ig = igdbToGame(IGDB_GAME); // 테스트 키친 / Test Kitchen, PC·콘솔
  const out = mergeGames([ig], [
    { id: 'grac-a', title: '테스트 키친 (PS4)', platforms: ['console'], ratingNo: 'A', rating: '전체이용가', ratingDate: '2020-01-01', stores: [] },
    { id: 'grac-b', title: 'Test Kitchen for Nintendo Switch', platforms: ['console'], ratingNo: 'B', rating: '전체이용가', ratingDate: '2021-01-01', stores: [] },
  ]);
  assert.deepEqual(out.map((g) => g.id), ['igdb-101']);
  assert.equal(out[0].ratingNo, 'B', '가장 최근 등급분류');
});

test('중복 제거: 괄호 안 영문명·_PC 표기로도 합침(플랫폼 겹칠 때만), 한글 이름은 깔끔하게', () => {
  const ig = igdbToGame({ ...IGDB_GAME, game_localizations: [] }); // Test Kitchen, PC·콘솔
  const pc = { id: 'grac-k', title: '테스트 부엌 (Test Kitchen)_PC', platforms: ['pc'], ratingNo: 'K', rating: '전체이용가', ratingDate: '2024-01-01', stores: [] };
  const out = mergeGames([ig], [pc]);
  assert.deepEqual(out.map((g) => g.id), ['igdb-101'], '게임위 카드를 따로 만들지 않음');
  assert.equal(out[0].ratingNo, 'K', '국내 등급 보완');
  assert.equal(out[0].originalTitle, '테스트 부엌', "'테스트 부엌 (Test Kitchen)_PC'가 아니라 한글 이름만");
  // 괄호 안 이름으로만 맞는데 플랫폼이 안 겹치면 다른 게임으로 봄
  const arcade = { ...pc, id: 'grac-x', title: '키친 기계 (Test Kitchen)', platforms: ['arcade'], ratingNo: 'X' };
  assert.deepEqual(mergeGames([ig], [arcade]).map((g) => g.id).sort(), ['grac-x', 'igdb-101']);
});

test('중복 제거: IGDB에 없는 같은 제목의 게임위 항목 여러 개 → 카드 하나', () => {
  const out = mergeGames([], [
    { id: 'grac-1', title: '하루 퍼즐', platforms: ['mobile'], platformsRaw: '모바일 게임', genres: ['puzzle'], genresRaw: '퍼즐', ratingNo: '1', ratingDate: '2025-01-01', rating: '전체이용가', stores: [] },
    { id: 'grac-2', title: '하루 퍼즐 (PC)', platforms: ['pc'], platformsRaw: 'PC/온라인 게임', genres: ['puzzle'], genresRaw: '퍼즐', ratingNo: '2', ratingDate: '2026-01-01', rating: '전체이용가', stores: [] },
    { id: 'grac-3', title: '다른 게임', platforms: ['pc'], ratingNo: '3', stores: [] },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'grac-2', '최신 등급분류 기준');
  assert.deepEqual(out[0].platforms.sort(), ['mobile', 'pc']);
  assert.equal(out[0].gracEntryCount, 2);
});

test('기본 제목 추출', async () => {
  const { baseTitle } = await import('../server/providers/igdbProvider.js');
  assert.equal(baseTitle('포털 2 (PS3)'), '포털 2');
  assert.equal(baseTitle('스타듀 밸리 for Nintendo Switch'), '스타듀 밸리');
  assert.equal(baseTitle('마인크래프트 - 모바일'), '마인크래프트');
  assert.equal(baseTitle('PC방 타이쿤'), 'PC방 타이쿤');
  assert.equal(baseTitle('Switch'), 'Switch');
});

test('서비스 종료(Offline) 게임 숨김: 목록에서 제외, 같은 제목의 게임위 항목도 따로 나오지 않음', async () => {
  const ended = { ...IGDB_GAME, id: 303, name: 'Ended Online', game_localizations: [{ name: '종료된 온라인', region: { name: 'Korea' } }], game_status: { status: 'Offline' } };
  const alive = { ...IGDB_GAME, game_status: { status: 'Released' } };
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/genres', () => json([])],
    ['/v4/platforms', () => json([])],
    ['/v4/games', () => json([alive, ended])],
  ]);
  const p = createIgdbProvider(cfg, { fetchImpl });
  const games = await p.searchByCriteria({ players: null, platforms: [], genres: [] });
  assert.equal(games.find((g) => g.id === 'igdb-303').hidden, true);
  assert.equal(games.find((g) => g.id === 'igdb-101').gameStatus, 'Released');
  const grac = [{ id: 'grac-e', title: '종료된 온라인', platforms: ['pc'], ratingNo: 'X', stores: [] }];
  const out = mergeGames(games, grac);
  assert.deepEqual(out.map((g) => g.id), ['igdb-101']);
  assert.equal((await p.featured(5)).some((g) => g.id === 'igdb-303'), false);
  // 상세는 열리되 hidden 표시
  const p1 = createIgdbProvider(cfg, { fetchImpl: mockFetch([[IGDB_TOKEN_URL, tokenOk], ['/v4/games', () => json([ended])]]) });
  assert.equal((await p1.getGame('igdb-303')).hidden, true);
  // 숨길 상태 설정 변경
  const p2 = createIgdbProvider({ ...cfg, hiddenStatuses: ['Offline', 'Delisted'] }, { fetchImpl: mockFetch([[IGDB_TOKEN_URL, tokenOk], ['/v4/games', () => json([{ ...IGDB_GAME, game_status: { status: 'Delisted' } }])]]) });
  assert.equal((await p2.getGame('igdb-101')).hidden, true);
});

test('글로벌 평점: IGDB 100점 만점 → 5점 만점, 이용자·평론가 내역, 평가 없으면 null', () => {
  const g = globalRatingFromIgdb({ total_rating: 87.43, total_rating_count: 1520, rating: 85.1, rating_count: 1400, aggregated_rating: 90, aggregated_rating_count: 120 });
  assert.deepEqual(g, { avg: 4.4, count: 1520, users: { avg: 4.3, count: 1400 }, critics: { avg: 4.5, count: 120 }, source: 'IGDB' });
  assert.deepEqual(globalRatingFromIgdb({ total_rating: 60, total_rating_count: 3, rating: 60, rating_count: 3 }).critics, null);
  assert.equal(globalRatingFromIgdb({ total_rating: 80, total_rating_count: 0 }), null);
  assert.equal(globalRatingFromIgdb({}), null);
  assert.equal(igdbToGame({ ...IGDB_GAME, total_rating: 100, total_rating_count: 2 }).globalRating.avg, 5);
  assert.equal(igdbToGame(IGDB_GAME).globalRating, null);
});

test('메뉴 목록 쿼리: 인기·최근 출시·출시 예정·평점 TOP·장르/플랫폼·페이지', async () => {
  const bodies = [];
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/genres', () => json([{ id: 12, name: 'Role-playing (RPG)' }])],
    ['/v4/platforms', () => json([{ id: 6, name: 'PC (Microsoft Windows)' }])],
    ['/v4/games', (u, init) => { bodies.push(init.body); return json([IGDB_GAME, { ...IGDB_GAME, id: 5, game_status: { status: 'Cancelled' } }]); }],
  ]);
  const now = () => Date.UTC(2026, 9, 29) ; // 고정 시각
  const p = createIgdbProvider(cfg, { fetchImpl, now });
  const t = Math.floor(now() / 1000);
  let r = await p.browse('popular', { offset: 24, limit: 2 });
  assert.match(bodies.at(-1), /sort total_rating_count desc; limit 2; offset 24;/);
  assert.equal(r.hasMore, true);
  assert.equal(r.games[0].matchNames, undefined);
  await p.browse('recent');
  assert.match(bodies.at(-1), new RegExp(`first_release_date >= ${t - 90 * 86400} & first_release_date <= ${t}.*sort hypes desc`));
  r = await p.browse('upcoming');
  assert.match(bodies.at(-1), new RegExp(`first_release_date > ${t}`));
  assert.deepEqual(r.games.map((g) => g.id), ['igdb-101'], '출시 예정에서 개발 취소 제외');
  await p.browse('top');
  assert.match(bodies.at(-1), /total_rating_count >= 100.*sort total_rating desc/);
  await p.browse('popular', { genre: 'rpg', platform: 'pc' });
  assert.match(bodies.at(-1), /genres = \(12\) & platforms = \(6\)/);
  const none = await p.browse('popular', { genre: 'racing' });
  assert.deepEqual(none, { games: [], hasMore: false }, 'IGDB에 없는 장르 id면 빈 목록');
  await assert.rejects(p.browse('nope'), { code: 'BAD_REQUEST' });
});

test('본편만: 쿼리에 version_parent·parent_game 조건, 시즌·DLC·번들은 결과에서 제외', async () => {
  const bodies = [];
  const rows = [
    { ...IGDB_GAME, id: 1, name: 'Overwatch 2', game_type: { type: 'Main Game' } },
    { ...IGDB_GAME, id: 2, name: 'Overwatch 2: Season 3', game_type: { type: 'Season' }, parent_game: 1 },
    { ...IGDB_GAME, id: 3, name: 'Overwatch 2: Invasion', game_type: { type: 'DLC' } },
    { ...IGDB_GAME, id: 4, name: 'Overwatch: Legendary Edition', game_type: { type: 'Bundle' } },
    { ...IGDB_GAME, id: 5, name: 'Some Standalone', game_type: { type: 'Standalone Expansion' } },
    { ...IGDB_GAME, id: 6, name: 'Old Remake', game_type: { type: 'Remake' } },
  ];
  const p = createIgdbProvider(cfg, { fetchImpl: mockFetch([[IGDB_TOKEN_URL, tokenOk], ['/v4/games', (u, init) => { bodies.push(init.body); return json(rows); }]]) });
  const found = await p.searchByTitle('overwatch', 10);
  assert.match(bodies.find((b) => b.startsWith('search')), /where version_parent = null & parent_game = null;/);
  assert.deepEqual(found.map((g) => g.id), ['igdb-1', 'igdb-5', 'igdb-6']);
  const { games } = await p.browse('popular');
  assert.match(bodies.at(-1), /version_parent = null & parent_game = null/);
  assert.deepEqual(games.map((g) => g.id), ['igdb-1', 'igdb-5', 'igdb-6']);
});

test('인원 조건 → IGDB where 절', () => {
  assert.equal(playersWhere(null), null);
  assert.equal(playersWhere(1), 'game_modes = (1)');
  assert.equal(
    playersWhere(3),
    '(multiplayer_modes.onlinemax >= 3 | multiplayer_modes.offlinemax >= 3 | multiplayer_modes.onlinecoopmax >= 3 | multiplayer_modes.offlinecoopmax >= 3)',
  );
});

test('전체 검색(findMatches): 필터를 IGDB에 보내고 개수·페이지 처리', async () => {
  const page = Array.from({ length: 24 }, (_, i) => ({ ...IGDB_GAME, id: 1000 + i }));
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/genres', () => json([{ id: 9, name: 'Simulator' }])],
    ['/v4/platforms', () => json([{ id: 6, name: 'PC (Microsoft Windows)' }])],
    ['/v4/games/count', () => json({ count: 1234 })],
    ['/v4/games', () => json(page)],
  ]);
  const p = createIgdbProvider(cfg, { fetchImpl });
  const r = await p.findMatches({ players: 4, platforms: ['pc'], genres: ['simulation'] }, { offset: 0, limit: 24 });
  assert.equal(r.total, 1234);
  assert.equal(r.games.length, 24);
  assert.equal(r.hasMore, true);
  const body = fetchImpl.calls.find((c) => c.url.endsWith('/v4/games')).init.body;
  assert.match(body, /genres = \(9\)/);
  assert.match(body, /platforms = \(6\)/);
  assert.match(body, /multiplayer_modes\.onlinemax >= 4/);
  assert.match(body, /parent_game = null/);
  assert.match(body, /sort total_rating_count desc; limit 24; offset 0;/);
  assert.doesNotMatch(body, /total_rating_count > 0/, '평가 수 제한 없이 전체 대상');
  const r2 = await p.findMatches({ players: 4, platforms: ['pc'], genres: ['simulation'] }, { offset: 24, limit: 24 });
  assert.match(fetchImpl.calls.at(-1).init.body, /offset 24;/);
  assert.equal(r2.total, null, '다음 페이지는 개수 다시 안 셈');
  // IGDB에 대응 장르가 없으면 조회 없이 0개
  const none = await p.findMatches({ players: null, platforms: [], genres: ['racing'] });
  assert.deepEqual(none, { games: [], total: 0, hasMore: false });
});

test('전체 검색 실패 → 기존 후보 목록 방식으로 대체 (catalog)', async () => {
  const grac = { label: 'GRAC', listGames: async () => [], searchByTitle: async () => [] };
  const igdb = { label: 'IGDB', configured: true, findMatches: async () => { throw new Error('400'); }, searchByCriteria: async () => [igdbToGame(IGDB_GAME)] };
  const c = createCatalog({ dataSource: 'live', grac: {} }, { igdb, grac, kr: { configured: false, enrich: async (g) => g } });
  const r = await c.findMatches({ players: 2, platforms: [], genres: [] }, {});
  assert.ok(r.failed);
});

test('IGDB에 같은 이름이 있는지: 이름·별칭·한국어명 정확 일치 조회', async () => {
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/games', () => json([{ id: 1, name: 'Tetris', alternative_names: [{ name: '테트리스' }], game_localizations: [{ name: '테트리스' }], platforms: [{ name: 'Nintendo Switch' }, { name: 'PC (Microsoft Windows)' }] }])],
  ]);
  const p = createIgdbProvider(cfg, { fetchImpl });
  const names = await p.findTitles(['테트리스', 'Say "hi"']);
  assert.deepEqual(names, ['Tetris', '테트리스', '테트리스'], '이름·slug 두 조회에서 같은 게임이 걸려도 한 번만');
  const bodies = fetchImpl.calls.filter((c) => String(c.url).includes('/v4/games')).map((c) => c.init.body);
  const nameQ = bodies.find((b) => b.includes('name ~'));
  assert.match(nameQ, /name ~ "테트리스" \| alternative_names\.name ~ "테트리스" \| game_localizations\.name ~ "테트리스"/);
  assert.match(nameQ, /name ~ "Say hi"/, '따옴표 제거');
  assert.ok(bodies.some((b) => /slug = \("say-hi"/.test(b)), '영문 이름은 slug로도');
  assert.deepEqual((await p.findTitleGames(['테트리스']))[0].platforms, ['console', 'pc']);
});

test('게임위 제목 → IGDB 이름 후보·slug (괄호 안 이름, 플랫폼 표기, 전각 기호)', async () => {
  const { titleVariants, titleSlugs } = await import('../server/providers/igdbProvider.js');
  assert.deepEqual(titleVariants('Portal 2(포탈 2)_PC'), ['Portal 2', '포탈 2']);
  assert.deepEqual(titleVariants('Left4Dead(레프트 4 데드-PC)'), ['Left4Dead', '레프트 4 데드']);
  assert.deepEqual(titleVariants('Baldur＇s Gate 3'), ["Baldur's Gate 3"]);
  assert.deepEqual(titleVariants('카트라이더 드리프트 (Kartrider Drift) [PC]'), ['카트라이더 드리프트', 'Kartrider Drift']);
  assert.deepEqual(titleVariants('PC_MONSTER HUNTER RISE (몬스터 헌터 라이즈)'), ['MONSTER HUNTER RISE', '몬스터 헌터 라이즈']);
  assert.deepEqual(titleVariants('오버워치 (NS) (Overwatch (NS))'), ['오버워치', 'Overwatch']);
  assert.deepEqual(titleVariants('LEFT4DEAD 2(레프트 4 데드 2)_Xbox360'), ['LEFT4DEAD 2', '레프트 4 데드 2']);
  assert.deepEqual(titleVariants('해리 포터: 퀴디치 챔피언 (Harry Potter Quidditch Champions))(닌텐도 스위치 버전)'), ['해리 포터: 퀴디치 챔피언', 'Harry Potter Quidditch Champions'], "끝의 'ns'를 플랫폼으로 지우지 않음");
  assert.deepEqual(titleSlugs('Kartrider Drift'), ['kartrider-drift']);
  assert.deepEqual(titleSlugs("Baldur's Gate 3"), ['baldurs-gate-3']);
  assert.ok(titleSlugs('Left4Dead').includes('left-4-dead'));
  assert.deepEqual(titleSlugs('카트라이더'), []);
});

test('띄어쓰기 없이 검색해도 찾기: lostark → slug lost-ark 도 함께 조회', async () => {
  const { spacingSlugs } = await import('../server/providers/igdbProvider.js');
  assert.ok(spacingSlugs('LostArk').includes('lost-ark'));
  assert.ok(spacingSlugs('leagueoflegends').includes('league-of-legends'));
  assert.deepEqual(spacingSlugs('로스트아크'), []);
  assert.deepEqual(spacingSlugs('lost ark'), [], '이미 띄어 썼으면 일반 검색으로 충분');
  const lostArk = { ...IGDB_GAME, id: 555, name: 'Lost Ark', game_localizations: [] };
  const fetchImpl = mockFetch([
    [IGDB_TOKEN_URL, tokenOk],
    ['/v4/games', (url, init) => json(/slug = \(/.test(init.body) ? [lostArk] : [])],
  ]);
  const p = createIgdbProvider(cfg, { fetchImpl });
  const games = await p.searchByTitle('lostark', 30);
  assert.equal(games[0].title, 'Lost Ark');
  const slugCall = fetchImpl.calls.find((c) => /slug = \(/.test(c.init?.body || ''));
  assert.match(slugCall.init.body, /"lost-ark"/);
  assert.match(slugCall.init.body, /parent_game = null/);
});

test('검색: 메이플 → IGDB에 한국어명이 있는 속편만 걸려도 게임위 본편이 맨 앞 (짧은 이름 먼저)', async () => {
  const ms2 = { ...IGDB_GAME, id: 20, name: 'MapleStory 2', game_localizations: [{ name: '메이플스토리 2', region: { name: 'Korea' } }], alternative_names: [] };
  const msM = { ...IGDB_GAME, id: 21, name: 'MapleStory M', game_localizations: [{ name: '메이플스토리 M', region: { name: 'Korea' } }], alternative_names: [] };
  const other = { ...IGDB_GAME, id: 22, name: 'Maple Leaf Golf', game_localizations: [], alternative_names: [] };
  const g = (id, title) => ({ id: `grac-${id}`, title, platforms: ['pc'], ratingNo: id, stores: [], source: '게임물관리위원회' });
  const kr = { configured: false, enrich: async (x) => x };
  const cat = createCatalog({ dataSource: 'live', krGameDb: {} }, {
    kr,
    igdb: { label: 'IGDB', configured: true, searchByTitle: async () => [igdbToGame(msM), igdbToGame(ms2), igdbToGame(other)] },
    grac: { label: '게임물관리위원회', searchByTitle: async () => [g('M2', '메이플스토리2'), g('MM', '메이플스토리 M'), g('M1', '메이플스토리'), g('X', '전혀 다른 게임')] },
  });
  const r = await cat.search('메이플');
  const titles = r.games.map((x) => x.title);
  assert.equal(titles[0], '메이플스토리', '본편이 맨 앞');
  assert.equal(titles.filter((t) => t.replace(/\s/g, '') === '메이플스토리2').length, 1, '속편은 IGDB 하나로 합쳐짐');
  assert.ok(!titles.includes('전혀 다른 게임'), '이름에 검색어가 없는 게임위 게임은 제외');
  assert.equal(titles.at(-1), 'Maple Leaf Golf', '검색어가 이름에 없는 IGDB 게임은 뒤로');
});

test('검색: 한글·영문 검색어가 같은 결과 (메이플 ↔ maplestory, 번역으로 서로 보완)', async () => {
  const ms = { ...IGDB_GAME, id: 30, name: 'MapleStory', game_localizations: [], alternative_names: [] };
  const ms2 = { ...IGDB_GAME, id: 31, name: 'MapleStory 2', game_localizations: [{ name: '메이플스토리 2', region: { name: 'Korea' } }], alternative_names: [] };
  const byQuery = {
    메이플: [ms2],
    Maple: [ms, ms2],
    maplestory: [ms, ms2],
  };
  const g = (id, title) => ({ id: `grac-${id}`, title, platforms: ['pc'], ratingNo: id, stores: [], source: '게임물관리위원회' });
  const gracBy = { 메이플: [g('M1', '메이플스토리'), g('M2', '메이플스토리2')], 메이플스토리: [g('M1', '메이플스토리'), g('M2', '메이플스토리2')], maplestory: [] };
  const dict = { 메이플: 'Maple', maplestory: '메이플스토리', 메이플스토리: 'MapleStory', 메이플스토리2: 'MapleStory 2' };
  const translate = async (texts) => texts.map((t) => dict[t] ?? null);
  const kr = { configured: false, enrich: async (x) => x };
  const cat = createCatalog({ dataSource: 'live', krGameDb: {} }, {
    kr,
    igdb: { label: 'IGDB', configured: true, searchByTitle: async (q) => (byQuery[q] ?? []).map((x) => igdbToGame(x)) },
    grac: { label: '게임물관리위원회', searchByTitle: async (q) => gracBy[q] ?? [] },
  });
  const ko = await cat.search('메이플', { translate });
  const en = await cat.search('maplestory', { translate });
  assert.deepEqual(ko.games.map((x) => x.id), ['igdb-30', 'igdb-31']);
  assert.deepEqual(en.games.map((x) => x.id), ko.games.map((x) => x.id), '같은 결과');
  assert.equal(ko.games[0].originalTitle, '메이플스토리', '게임위 한글 이름이 IGDB 본편에 붙음');
  assert.equal(ko.games[0].ratingNo, 'M1', '국내 등급도 보완');
  // 번역이 없으면 예전처럼 동작
  const plain = await cat.search('메이플');
  assert.ok(plain.games.some((x) => x.id === 'grac-M1'));
});

test('스크린샷: 이미 받은 IGDB 응답에서 주소만 (최대 6장, 없으면 아트워크)', () => {
  const shots = Array.from({ length: 8 }, (_, i) => ({ url: `//images.igdb.com/igdb/image/upload/t_thumb/s${i}.jpg` }));
  const g = igdbToGame({ ...IGDB_GAME, screenshots: shots });
  assert.equal(g.screenshots.length, 6);
  assert.equal(g.screenshots[0], 'https://images.igdb.com/igdb/image/upload/t_screenshot_big/s0.jpg');
  assert.equal(g.screenshotSource, 'IGDB');
  const a = igdbToGame({ ...IGDB_GAME, screenshots: [], artworks: [{ url: '//images.igdb.com/igdb/image/upload/t_thumb/art.jpg' }] });
  assert.deepEqual(a.screenshots, ['https://images.igdb.com/igdb/image/upload/t_screenshot_big/art.jpg']);
  assert.equal(igdbToGame({ ...IGDB_GAME, screenshots: [], artworks: [] }).screenshots, undefined);
});
