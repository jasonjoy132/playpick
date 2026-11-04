import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGracXml, createGracProvider, GRAC_DEFAULT_URL } from '../server/providers/gracProvider.js';
import { createKrGameDbProvider } from '../server/providers/krGameDbProvider.js';
import { mapGracValue, GENRES, PLATFORMS } from '../server/services/taxonomy.js';
import { GUIDE_SAMPLE } from './fixtures.js';

const ERROR_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<error><message>요청 변수 중 필수값이 지정되지 않았습니다.</message><error_code>0011</error_code></error>`;

const cfg = { url: '', display: 1000, maxPages: 1, startDate: '', endDate: '', cacheTtlSec: 60 };
const okFetch = (xml) => async () => ({ ok: true, status: 200, text: async () => xml });

test('가이드 샘플 파싱: 등급거부·등급취소 제외, 필드 매핑, 없는 정보는 null', () => {
  const { total, games } = parseGracXml(GUIDE_SAMPLE);
  assert.equal(total, 3);
  assert.equal(games.length, 1, '게임물명1(등급거부)·게임물명3(취소) 제외');
  const g = games[0];
  assert.equal(g.id, 'grac-CC-NM-230601-xxx');
  assert.equal(g.title, '게임물명2');
  assert.equal(g.rating, '청소년이용불가');
  assert.deepEqual(g.genres, ['action']);
  assert.deepEqual(g.platforms, ['pc']);
  assert.equal(g.contentDescriptors, '폭력성,언어');
  assert.equal(g.players, null);
  assert.deepEqual(g.stores, []);
  assert.equal(g.imageUrl, null);
  assert.equal(g.isDemo, false);
});

test('장르·플랫폼: 가이드 값과 정확히 일치할 때만 매핑', () => {
  assert.deepEqual(mapGracValue('전략시뮬레이션', GENRES), ['strategy']);
  assert.deepEqual(mapGracValue('MMORPG', GENRES), ['rpg']);
  assert.deepEqual(mapGracValue('FPS/TPS', GENRES), ['shooting']);
  assert.deepEqual(mapGracValue('격투게임', GENRES), ['action']);
  assert.equal(mapGracValue('보드게임(베팅성)', GENRES), null);
  assert.equal(mapGracValue('캐주얼', GENRES), null);
  assert.equal(mapGracValue('기타', GENRES), null);
  assert.deepEqual(mapGracValue('비디오 게임', PLATFORMS), ['console']);
  assert.deepEqual(mapGracValue('모바일 게임', PLATFORMS), ['mobile']);
  assert.deepEqual(mapGracValue('PC/온라인 게임, 모바일 게임', PLATFORMS), ['pc', 'mobile']);
  assert.equal(mapGracValue('', PLATFORMS), null);
});

test('요청: 기본 주소(/game 경로), 필수 변수, 빈 선택 변수 미전송, 인증키 없음, 캐시', async () => {
  let calls = 0, lastUrl;
  const p = createGracProvider(cfg, { fetchImpl: async (url) => { calls++; lastUrl = url; return okFetch(GUIDE_SAMPLE)(); } });
  await p.listGames();
  await p.listGames();
  assert.equal(calls, 1, '캐시 사용');
  assert.equal(`${lastUrl.origin}${lastUrl.pathname}`, GRAC_DEFAULT_URL);
  assert.equal(lastUrl.searchParams.get('display'), '1000');
  assert.equal(lastUrl.searchParams.get('pageno'), '1');
  assert.deepEqual([...lastUrl.searchParams.keys()].sort(), ['display', 'pageno']);
});

test('상세 조회: rateno로 요청', async () => {
  let lastUrl;
  const p = createGracProvider(cfg, { fetchImpl: async (url) => { lastUrl = url; return okFetch(GUIDE_SAMPLE)(); } });
  const g = await p.getGame('grac-CC-NM-230601-xxx');
  assert.equal(g.title, '게임물명2');
  assert.equal(lastUrl.searchParams.get('rateno'), 'CC-NM-230601-xxx');
});

test('오류: <error> 응답, HTTP 오류, 형식 오류, 네트워크 오류', async () => {
  await assert.rejects(createGracProvider(cfg, { fetchImpl: okFetch(ERROR_SAMPLE) }).listGames(), (e) => {
    assert.equal(e.code, 'UPSTREAM_ERROR');
    assert.match(e.message, /0011/);
    assert.match(e.message, /필수값/);
    return true;
  });
  await assert.rejects(createGracProvider(cfg, { fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'Server Error' }) }).listGames(), { code: 'UPSTREAM_HTTP' });
  await assert.rejects(createGracProvider(cfg, { fetchImpl: okFetch('<html>not xml') }).listGames(), (e) => ['UPSTREAM_INVALID'].includes(e.code));
  await assert.rejects(createGracProvider(cfg, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }).listGames(), { code: 'UPSTREAM_NETWORK' });
});

test('국내 게임 DB: 미설정이면 보강 없음, 설정됐지만 미구현이면 명시적 오류', async () => {
  const games = [{ id: 'a' }];
  assert.equal(await createKrGameDbProvider({ url: '', key: '' }).enrich(games), games);
  await assert.rejects(createKrGameDbProvider({ url: 'https://x', key: 'k' }).enrich(games), { code: 'NOT_IMPLEMENTED' });
});

test('ASMX 문자열 래핑 응답도 처리', () => {
  const inner = GUIDE_SAMPLE.replace(/^<\?xml[^>]*\?>\s*/, '');
  const esc = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { games } = parseGracXml(`<?xml version="1.0" encoding="utf-8"?><string xmlns="http://tempuri.org/">${esc}</string>`);
  assert.equal(games.length, 1);
  assert.equal(games[0].title, '게임물명2');
});

test('제목 검색: gametitle 변수로 요청', async () => {
  let lastUrl;
  const p = createGracProvider(cfg, { fetchImpl: async (url) => { lastUrl = url; return okFetch(GUIDE_SAMPLE)(); } });
  const games = await p.searchByTitle('게임물명2');
  assert.equal(lastUrl.searchParams.get('gametitle'), '게임물명2');
  assert.equal(games[0].domesticRating, true);
});
