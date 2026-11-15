// 정보 수정 제보로 고친 제목·소개·출시일·개발사·플랫폼·장르·구매처 빼기 → 상세·추천 목록·장르별 게임에 반영
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { validateFix } from '../server/community/reports.js';
import { evaluateGame } from '../server/services/recommend.js';

const game = (id, genres, count, extra = {}) => ({
  id, title: `게임 ${id}`, source: 'IGDB', platforms: ['pc'], genres, players: { min: 1, max: 4 }, recommendedPlayers: { min: 1, max: 4, source: 'igdb' },
  stores: [{ name: 'Steam', url: `https://store.steampowered.com/app/${id.slice(5)}/` }], imageUrl: null, altNames: [], globalRating: { avg: 4, count }, ...extra,
});
// IGDB 쪽 자료(고치기 전) — IGDB 검색은 이 장르로만 걸림
const NATIVE = { 'igdb-1': game('igdb-1', ['action'], 100), 'igdb-2': game('igdb-2', ['puzzle'], 50), 'igdb-3': game('igdb-3', ['action'], 10) };
const GRAC = { id: 'grac-G1', title: '국내 게임', source: '게임물관리위원회', platforms: ['pc'], genres: ['puzzle'], players: null, stores: [], imageUrl: null };
const byGenre = (genres) => Object.values(NATIVE).filter((g) => !genres?.length || g.genres.some((x) => genres.includes(x)));
let gracCalls = [];
const catalog = {
  meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
  getGame: async (id) => NATIVE[id] ?? (id === GRAC.id ? GRAC : null),
  getMany: async (ids) => ids.map((id) => NATIVE[id]).filter(Boolean),
  findMatches: async (criteria, { offset }) => ({ games: offset ? [] : byGenre(criteria.genres), total: byGenre(criteria.genres).length, hasMore: false }),
  listGames: async () => ({ games: [], warnings: [] }),
  browse: async (kind, { genre }) => ({ games: byGenre(genre ? [genre] : []), hasMore: false }),
  // 진짜 게관위 고르기처럼: 받은 patch(고친 값)로 판정해 모든 조건이 맞는 것만
  gracMatches: async (criteria, opt) => {
    gracCalls.push(opt);
    const ok = evaluateGame(opt.patch ? opt.patch(GRAC) : GRAC, criteria).checks.every((c) => c.key === 'players' || c.status === 'match');
    return { status: 'ready', items: ok && !opt.offset ? [{ game: GRAC }] : [], total: ok ? 1 : 0, hasMore: false, nextOffset: 1 };
  },
};
const partySize = { configured: false, size: 0, applyCached: (g) => g, fill: async (games) => ({ games, warning: null }) };

let server, base;
before(async () => {
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['boss@example.com'], hideUnknownGrac: false },
    { catalog, partySize, mailer: { configured: false, devLog: false, send: async () => {} } },
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
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
}

test('정보 수정 값 검사: 새 칸', () => {
  assert.deepEqual(
    validateFix({ title: ' 새 이름 ', summary: '소개\n둘째 줄', releaseDate: '2024-05-01', publisher: '회사', platforms: ['pc', 'pc'], genres: ['puzzle'], removeStores: ['https://store.steampowered.com/app/1/'] }),
    { title: '새 이름', summary: '소개\n둘째 줄', releaseDate: '2024-05-01', publisher: '회사', platforms: ['pc'], genres: ['puzzle'], removeStores: ['https://store.steampowered.com/app/1/'] },
  );
  assert.equal(validateFix({ releaseDate: '2024' }).releaseDate, '2024');
  assert.throws(() => validateFix({ releaseDate: '24-5-1' }), /출시일/);
  assert.throws(() => validateFix({ genres: ['fps'] }), /알 수 없는 장르/);
  assert.throws(() => validateFix({ platforms: [] }), /하나 이상/);
  assert.throws(() => validateFix({ platforms: ['arcade'] }), /알 수 없는 플랫폼/, '숨긴 플랫폼(아케이드)은 안 됨');
  assert.throws(() => validateFix({ removeStores: ['javascript:alert(1)'] }), /구매처/);
});

test('관리자가 고친 제목·소개·출시일·개발사·구매처 빼기 → 상세에 반영(출처 표시용 userFixed)', async () => {
  const admin = client();
  await admin('POST', '/api/auth/signup', { loginId: 'boss1', password: 'secret123', nickname: '보스', email: 'boss@example.com' });
  await server.db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run('boss@example.com');
  const r = await admin('POST', '/api/games/igdb-1/reports', {
    kind: 'fix', title: '한국어 이름', summary: '새 소개', releaseDate: '2020-01-02', publisher: '새 회사', removeStores: ['https://store.steampowered.com/app/1/'],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.item.status, 'approved');
  assert.deepEqual(r.body.item.lines.map((l) => l.field), ['title', 'summary', 'releaseDate', 'publisher', 'removeStores']);
  const g = (await admin('GET', '/api/games/igdb-1')).body.game;
  assert.equal(g.title, '한국어 이름');
  assert.equal(g.originalTitle, '게임 igdb-1', '원래 이름은 원제로');
  assert.equal(g.summaryKo, '새 소개');
  assert.equal(g.releaseDate, '2020-01-02');
  assert.equal(g.publisher, '새 회사');
  assert.deepEqual(g.stores, [], '뺀 구매처는 안 보임');
  assert.deepEqual(g.userFixed.sort(), ['publisher', 'releaseDate', 'summary', 'title']);
});

test('회원 제보로 장르를 고치면 승인 전엔 그대로, 승인되면 추천 목록·장르별 게임에 반영(넣기·빼기 모두)', async () => {
  const member = client();
  await member('POST', '/api/auth/signup', { loginId: 'member1', password: 'secret123', nickname: '회원1', email: 'm1@example.com' });
  const admin = client();
  await admin('POST', '/api/auth/login', { loginId: 'boss1', password: 'secret123' });
  const full = async () => (await (await fetch(`${base}/api/recommendations?platforms=pc&genres=action`)).json()).fullMatches.map((x) => x.game.id);
  const genrePage = async () => (await (await fetch(`${base}/api/browse/genre?genre=action`)).json()).games.map((g) => g.id);
  assert.deepEqual(await full(), ['igdb-1', 'igdb-3']);

  // 퍼즐 게임(igdb-2)을 액션으로, 액션 게임(igdb-3)을 퍼즐로
  const a = await member('POST', '/api/games/igdb-2/reports', { kind: 'fix', genres: ['action'] });
  const b = await member('POST', '/api/games/igdb-3/reports', { kind: 'fix', genres: ['puzzle'] });
  assert.equal(a.body.item.status, 'pending');
  assert.deepEqual(await full(), ['igdb-1', 'igdb-3'], '승인 전엔 그대로');
  await admin('POST', `/api/admin/reports/${a.body.item.id}/approve`, {});
  await admin('POST', `/api/admin/reports/${b.body.item.id}/approve`, {});

  assert.deepEqual(await full(), ['igdb-1', 'igdb-2'], 'IGDB 검색에 안 걸린 igdb-2는 평가 수 자리에 끼고, 장르를 뺀 igdb-3은 빠짐');
  assert.deepEqual(await genrePage(), ['igdb-1', 'igdb-2'], '장르별 게임도 같게');
  const tag = (await member('GET', '/api/games/igdb-2')).body.game;
  assert.deepEqual(tag.genres, ['action'], '장르 태그도 바뀜');
  assert.ok(tag.userFixed.includes('genres'));
});

test('게관위 게임: 고친 장르로 고름(patch 전달)', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { loginId: 'boss1', password: 'secret123' });
  const has = async () => (await (await fetch(`${base}/api/recommendations?platforms=pc&genres=racing`)).json()).fullMatches.some((x) => x.game.id === 'grac-G1');
  assert.equal(await has(), false);
  await admin('POST', '/api/games/grac-G1/reports', { kind: 'fix', genres: ['racing'] });
  assert.equal(await has(), true, '레이싱으로 고친 게관위 게임이 레이싱 검색에 나옴');
  assert.ok(gracCalls.at(-1).patchKey.includes('grac-G1'), '고친 값이 바뀌면 고르기 캐시 키도 바뀜');
});
