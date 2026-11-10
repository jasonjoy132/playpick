// 게관위 새 게임: 하루 한 번 수집(시드에 없는 것만) → 스토어 근거(Steam·App Store) → AI 추천 인원,
// 못 찾으면 7일마다 다시(최대 4번)·등급분류 6개월 안이면 '최근 등급분류'로 보임, cron 인증, 관리자 실행
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createGracNew, overlayEntries, buildStorePrompt, fixByFeatures } from '../server/services/gracNew.js';
import { createPartySize } from '../server/services/partySize.js';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-20T03:00:00Z');
const G = (no, title, extra = {}) => ({
  id: `grac-${no}`,
  title,
  source: '게임물관리위원회',
  publisher: '테스트게임즈',
  platforms: ['pc'],
  platformsRaw: 'PC/온라인 게임',
  genres: ['action'],
  genresRaw: '액션',
  players: null,
  recommendedPlayers: null,
  ratingNo: no,
  ratingDate: '2026-11-18',
  stores: [],
  imageUrl: null,
  ...extra,
});
const SEED = [G('OLD-1', '예전 게임', { ratingDate: '2026-11-10' })];
const NEW = [
  G('N-1', '친구 파티 대전'), // Steam 출시됨 → 인원 2~4
  G('N-2', '곧 나올 게임'), // Steam 곧 출시
  G('N-3', '퍼즐 냥이', { platformsRaw: '모바일 게임', platforms: ['mobile'] }), // App Store
  G('N-4', '어디에도 없는 게임'), // 못 찾음
  G('N-5', '취소된 게임', { canceled: true }),
  SEED[0], // 시드에 이미 있음 → 저장 안 함
];

/** 가짜 Steam·Gemini */
function fakeFetch(log = [], { geminiFails = false, steamFails = false } = {}) {
  return async (url, opt = {}) => {
    const u = new URL(String(url));
    log.push(u.host + u.pathname);
    if (u.pathname === '/api/storesearch/') {
      if (steamFails) return new Response('down', { status: 503 });
      const term = u.searchParams.get('term');
      const items = { '친구 파티 대전': [{ type: 'app', id: 11, name: '친구 파티 대전' }], '곧 나올 게임': [{ type: 'app', id: 22, name: '곧 나올 게임' }] }[term] ?? [];
      return Response.json({ items });
    }
    if (u.pathname === '/api/appdetails') {
      const id = u.searchParams.get('appids');
      const data = id === '11' ? { short_description: '친구와 2~4인 파티 대전', categories: [{ description: 'Online Co-op' }, { description: 'Multi-player' }], release_date: { coming_soon: false } } : { short_description: '곧 출시', release_date: { coming_soon: true } };
      return Response.json({ [id]: { success: true, data } });
    }
    if (u.host === 'generativelanguage.googleapis.com') {
      if (geminiFails) return new Response('{}', { status: 503 });
      const prompt = JSON.parse(opt.body).contents[0].parts[0].text;
      const lines = prompt.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
      const ans = lines.map((x) => (x.name === '친구 파티 대전' ? { id: x.id, min: 2, max: 4, hours: null } : x.name === '퍼즐 냥이' ? { id: x.id, min: 1, max: 1, hours: 10 } : { id: x.id, min: null, max: null, hours: null }));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }], modelVersion: 'fake-gemini' });
    }
    throw new Error(`unexpected ${url}`);
  };
}
const appStore = {
  search: async (term) => (term === '퍼즐 냥이' ? [{ trackName: '퍼즐 냥이', sellerName: '테스트게임즈 주식회사', trackViewUrl: 'https://apps.apple.com/kr/app/x/id9', description: '혼자 하는 퍼즐', genres: ['Puzzle'] }] : []),
};
const grac = {
  calls: [],
  fetchPage: async (opt) => {
    grac.calls.push(opt);
    return { total: NEW.length, games: NEW };
  },
};

function make({ now = () => T0, ...opt } = {}) {
  const db = openDb(':memory:');
  const log = [];
  const svc = createGracNew(db, { grac, appStore, seedGames: () => SEED, ai: { apiKey: 'k' }, fetchImpl: fakeFetch(log, opt), now, ...opt });
  return { db, svc, log };
}

test('수집: 시드 가장 최근 등급분류일 이틀 전부터, 시드에 없는 것만 저장', async () => {
  grac.calls.length = 0;
  const { svc } = make();
  const r = await svc.sync();
  assert.equal(grac.calls[0].startdate, '2026-11-08');
  assert.equal(r.saved, 5); // 시드 1개 빼고(취소된 것도 저장 — 판단·목록에서 뺌)
  const { games } = await svc.load();
  assert.deepEqual(games.map((g) => g.ratingNo).sort(), ['N-1', 'N-2', 'N-3', 'N-4', 'N-5']);
});

test('판단: Steam 출시→서비스 중+AI 인원, 곧 출시→출시 예정, App Store(개발사 일치)→서비스 중, 못 찾음→7일 뒤 다시(최대 4번), 취소는 안 봄', async () => {
  let t = T0;
  const { svc, log } = make({ now: () => t });
  await svc.sync();
  const r = await svc.judge();
  assert.deepEqual(r.count, { released: 2, upcoming: 1, notFound: 1 });
  const items = await svc.recent();
  const by = Object.fromEntries(items.map((x) => [x.title, x.judgement]));
  assert.equal(by['친구 파티 대전'].status, 'released');
  assert.equal(by['친구 파티 대전'].storeUrl, 'https://store.steampowered.com/app/11');
  assert.deepEqual([by['친구 파티 대전'].min, by['친구 파티 대전'].max], [2, 4]);
  assert.equal(by['곧 나올 게임'].status, 'upcoming');
  assert.equal(by['퍼즐 냥이'].storeName, 'App Store');
  assert.deepEqual([by['퍼즐 냥이'].min, by['퍼즐 냥이'].max, by['퍼즐 냥이'].hours], [1, 1, 10]);
  assert.equal(by['어디에도 없는 게임'].status, null);
  assert.equal(by['어디에도 없는 게임'].tries, 1);
  assert.equal(by['취소된 게임'], null);
  // 모바일 게임은 Steam 에서 찾지 않음 (Steam 검색은 PC 게임 3개 × 이름 후보만)
  assert.ok(log.filter((l) => l.includes('storesearch')).length <= 3 * 3);

  // 바로 다시: 아무것도 안 봄
  assert.equal((await svc.judge()).checked, 0);
  // 8일 뒤: 못 찾은 것만 다시
  for (let i = 2; i <= 4; i++) {
    t += 8 * DAY;
    const again = await svc.judge();
    assert.equal(again.checked, 1);
  }
  t += 8 * DAY;
  assert.equal((await svc.judge()).checked, 0, '4번 찾고 나면 그만');
});

test('AI 오류여도 스토어 근거(상태)는 저장, 인원은 모름 / 스토어 오류면 저장 안 함(다음에 다시)', async () => {
  const a = make({ geminiFails: true });
  await a.svc.sync();
  const r = await a.svc.judge();
  assert.equal(r.count.released, 2);
  assert.ok(r.errors.some((e) => e.startsWith('AI:')));
  const it = (await a.svc.recent()).find((x) => x.title === '친구 파티 대전').judgement;
  assert.equal(it.status, 'released');
  assert.equal(it.min, null);

  const b = make({ steamFails: true });
  await b.svc.sync();
  const r2 = await b.svc.judge();
  assert.equal(r2.count.released, 1); // App Store 게임만
  assert.equal((await b.svc.recent()).find((x) => x.title === '친구 파티 대전').judgement, null);
});

test('파일(party-size.json)에 이미 판단이 있는 게임은 묻지 않음, 프롬프트에는 스토어 정보만', async () => {
  const { svc } = make({ hasFileJudgement: (g) => g.title === '친구 파티 대전' });
  await svc.sync();
  const r = await svc.judge();
  assert.equal(r.count.released, 1);
  assert.deepEqual((await svc.recent()).find((x) => x.title === '친구 파티 대전').judgement, { fromFile: true });
  const p = buildStorePrompt([{ game: NEW[0], found: { info: { storeTitle: 'X', description: '설명', features: ['협동'] } } }]);
  assert.match(p, /ONLY this information/);
  assert.match(p, /"description":"설명"/);
});

test('덧씌우기 항목: 찾음 → 상태·스토어, 못 찾음·아직 → recentNew, 취소 → 없음', async () => {
  const { svc } = make();
  await svc.sync();
  await svc.judge();
  const m = overlayEntries(await svc.load());
  const k = (t) => [...m.entries()].find(([key]) => key.includes(t.replace(/\s/g, '')))?.[1];
  assert.equal(k('친구파티대전').status, 'released');
  assert.equal(k('친구파티대전').storeName, 'Steam');
  assert.equal(k('어디에도없는게임').recentNew, true);
  assert.equal(k('취소된게임'), undefined);
});

// ── 앱에 붙였을 때: 목록 규칙·cron·관리자 ──
let server, base, tmp;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-gracnew-'));
  const dataFile = path.join(tmp, 'party-size.json');
  fs.writeFileSync(dataFile, JSON.stringify({ 'grac:다른게임': { status: 'released', ended: false } })); // 파일이 있어야 '모름' 숨김 규칙이 켜짐
  const partySize = createPartySize({ dataFile });
  let extra = [];
  const all = () => [...SEED, ...extra];
  const catalog = {
    meta: { dataSource: 'live', isDemo: false, sources: ['IGDB'] },
    gracFeed: { grac, seedGames: () => SEED, setExtra: (g) => (extra = g) },
    getGame: async (id) => all().find((g) => g.id === id) ?? null,
    browse: async () => ({ games: [], hasMore: false }),
    search: async () => ({ games: all(), warnings: [] }),
    domesticGames: () => all(),
  };
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, hideUnknownGrac: true, cronSecret: 's3cret', gemini: { apiKey: 'test-key' }, adminEmails: ['boss@example.com'] },
    { catalog, partySize, gracNewFetch: fakeFetch(), appStore: { enabled: true, ...appStore }, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('cron: 비밀 값이 없거나 틀리면 401, 맞으면 수집·판단 → 목록에 반영(서비스 중·최근 등급분류는 보임, 출시 예정은 출시 예정에만)', async () => {
  assert.equal((await fetch(`${base}/api/cron/grac`)).status, 401);
  assert.equal((await fetch(`${base}/api/cron/grac`, { headers: { Authorization: 'Bearer nope' } })).status, 401);
  // 수집 전: 새 게임 없음
  let ids = (await (await fetch(`${base}/api/search?q=x`)).json()).games.map((g) => g.id);
  assert.ok(!ids.includes('grac-N-1'));
  const r = await (await fetch(`${base}/api/cron/grac`, { headers: { Authorization: 'Bearer s3cret' } })).json();
  assert.equal(r.ok, true);
  assert.equal(r.saved, 5);
  const games = (await (await fetch(`${base}/api/search?q=x`)).json()).games;
  ids = games.map((g) => g.id);
  assert.ok(ids.includes('grac-N-1'), '스토어에서 찾은 서비스 중 게임');
  assert.ok(ids.includes('grac-N-3'), 'App Store 게임');
  const recent = games.find((g) => g.id === 'grac-N-4');
  assert.ok(recent?.aiRecent, '못 찾았지만 최근 등급분류');
  assert.ok(!ids.includes('grac-N-2'), '출시 예정은 일반 목록에 없음');
  assert.ok(!ids.includes('grac-N-5'), '취소된 등급');
  const n1 = games.find((g) => g.id === 'grac-N-1');
  assert.deepEqual(n1.recommendedPlayers, { min: 2, max: 4, source: 'ai' });
  assert.ok(n1.stores.some((s) => s.url === 'https://store.steampowered.com/app/11'));
  // 출시 예정 목록
  const up = await (await fetch(`${base}/api/browse/upcoming`)).json();
  assert.ok(JSON.stringify(up).includes('grac-N-2'));
});

test('관리자만 새 게임 목록·지금 받기', async () => {
  const anon = await fetch(`${base}/api/admin/grac-new`);
  assert.equal(anon.status, 401);
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/signup', { loginId: 'member9', password: 'pass1234', nickname: '회원9', email: 'm9@example.com' });
  assert.equal((await call('GET', '/api/admin/grac-new')).status, 403);
  cookie = '';
  await call('POST', '/api/auth/signup', { loginId: 'boss1', password: 'pass1234', nickname: '관리자', email: 'boss@example.com' });
  const list = await call('GET', '/api/admin/grac-new');
  assert.equal(list.body.available, true);
  assert.match(list.body.lastRun.note, /새 게임 5개/);
  assert.equal(list.body.items.length, 5);
  const run = await call('POST', '/api/admin/grac-new/run');
  assert.equal(run.status, 200);
  assert.equal(run.body.saved, 0, '이미 받은 게임은 그대로');
});

test('Steam 기능으로 인원 보정: 싱글만 → 1~1, 멀티 기능인데 AI가 1명 → 모름, App Store는 그대로', () => {
  const steam = (features) => ({ evidence: 'steam', info: { features } });
  assert.deepEqual(fixByFeatures(null, steam(['Single-player', 'Steam Achievements'])), { min: 1, max: 1 });
  assert.deepEqual(fixByFeatures({ min: 2, max: 8 }, steam(['Single-player'])), { min: 1, max: 1 });
  assert.equal(fixByFeatures({ min: 1, max: 1 }, steam(['Single-player', 'Online Co-op'])), null);
  assert.deepEqual(fixByFeatures({ min: 1, max: 4 }, steam(['Shared/Split Screen'])), { min: 1, max: 4 });
  assert.deepEqual(fixByFeatures({ min: 1, max: 1 }, { evidence: 'appstore', info: {} }), { min: 1, max: 1 });
  assert.equal(fixByFeatures(null, steam([])), null);
});

test('아케이드 기계·교육용·체험판 새 게임은 스토어를 찾지 않음', async () => {
  const saved = NEW.splice(0, NEW.length, G('A-1', '인형뽑기 기계', { platforms: ['arcade'], platformsRaw: '아케이드 게임' }), G('A-2', '친구 파티 대전 체험판'));
  try {
    const { svc, log } = make();
    await svc.sync();
    const r = await svc.judge();
    assert.equal(r.checked, 0);
    assert.equal(log.filter((l) => l.includes('storesearch')).length, 0);
  } finally {
    NEW.splice(0, NEW.length, ...saved);
  }
});
