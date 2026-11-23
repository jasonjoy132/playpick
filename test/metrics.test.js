// 성과 분석(원페이저 지표): 익명 기록 받기·거르기, 지표 계산, 관리자만 보기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { cleanEvent, computeMetrics, isBot } from '../server/services/metrics.js';

let clock = Date.parse('2026-11-20T03:00:00Z'); // 한국 11월 20일 낮
let server, base;
before(async () => {
  server = createApp(
    { ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {}, adminEmails: ['boss@example.com'] },
    { now: () => clock, mailer: { configured: false, devLog: false, send: async () => {} } },
  );
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client(ua = 'Mozilla/5.0 test') {
  let cookie = '';
  return async (method, path, body, extra = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'User-Agent': ua, ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : null };
  };
}
const ev = (c, kind, data = {}, vid = 'visitor0001') => c('POST', '/api/events', { kind, vid, ...data });

test('기록 값 확인: 모르는 종류·이상한 키·필수 값 없음은 거절, 봇 판별', () => {
  assert.equal(cleanEvent({ kind: 'hack', vid: 'abcdefgh1' }), null);
  assert.equal(cleanEvent({ kind: 'visit', vid: 'short' }), null);
  assert.equal(cleanEvent({ kind: 'detail', vid: 'abcdefgh1' }), null, '상세는 게임 id 필요');
  assert.equal(cleanEvent({ kind: 'feedback', vid: 'abcdefgh1', value: 'meh' }), null);
  assert.equal(cleanEvent({ kind: 'detail', vid: 'abcdefgh1', gameId: 'g1', from: '<x>' }).meta.from, 'other');
  assert.ok(isBot('Googlebot/2.1') && isBot('') && !isBot('Mozilla/5.0'));
});

test('지표 계산: 클릭률·구매처 비율·만족도·재방문율·0개 비율·단계별', () => {
  const r = (vid, day, kind, extra = {}) => ({ vid, day, kind, gameId: null, store: null, meta: null, ...extra });
  const rows = [
    // a: 추천 → 상세(추천에서) → 구매처, 다음 날 다시 옴
    r('a', 'd1', 'visit'), r('a', 'd1', 'results', { meta: { zero: false } }), r('a', 'd1', 'detail', { gameId: 'g1', meta: { from: 'results' } }),
    r('a', 'd1', 'store_click', { gameId: 'g1', store: 'Steam' }), r('a', 'd2', 'visit'), r('a', 'd1', 'feedback', { meta: { value: 'up' } }),
    // b: 추천만 보고 끝(0개), 별로예요
    r('b', 'd1', 'visit'), r('b', 'd1', 'results', { meta: { zero: true } }), r('b', 'd1', 'feedback', { meta: { value: 'down' } }),
    // c: 검색에서 상세만
    r('c', 'd1', 'visit'), r('c', 'd1', 'detail', { gameId: 'g2', meta: { from: 'search' } }),
  ];
  const m = computeMetrics(rows);
  assert.equal(m.visitors, 3);
  assert.equal(m.recClickRate, 50); // 추천 본 a·b 중 a
  assert.equal(m.storeRate, 50); // (a,g1)·(c,g2) 중 (a,g1)
  assert.equal(m.satisfaction, 50);
  assert.equal(m.feedbackCount, 2);
  assert.equal(m.returnRate, 33.3);
  assert.equal(m.zeroRate, 50);
  assert.deepEqual(m.funnel.map((s) => s.n), [3, 2, 1, 1]);
  assert.deepEqual(m.stores, [{ name: 'Steam', n: 1 }]);
  assert.equal(computeMetrics([]).recClickRate, null, '기록 없으면 비율 없음(0%로 꾸미지 않음)');
});

test('기록 API: 헤더 없으면 403, 잘못된 값 400, 봇은 저장 안 함, 같은 날 방문·같은 조건 만족도는 한 번', async () => {
  const c = client();
  const raw = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'visit', vid: 'visitor0001' }) });
  assert.equal(raw.status, 403);
  assert.equal((await ev(c, 'nope')).status, 400);
  assert.equal((await ev(client('Googlebot/2.1'), 'visit', {}, 'botvisitor1')).status, 204);
  for (let i = 0; i < 2; i++) assert.equal((await ev(c, 'visit')).status, 204);
  await ev(c, 'feedback', { value: 'up', q: 'players=2' });
  await ev(c, 'feedback', { value: 'down', q: 'players=2' });
  const rows = await server.db.prepare('SELECT vid, kind FROM events').all();
  assert.deepEqual(rows.map((x) => `${x.vid}:${x.kind}`).sort(), ['visitor0001:feedback', 'visitor0001:visit']);
});

test('성과는 관리자만, 관리자 본인 기록은 안 셈, 지난 기간과 비교', async () => {
  const c = client();
  await ev(c, 'results', { q: 'players=2', zero: false });
  await ev(c, 'detail', { gameId: 'demo-1', from: 'results' });
  await ev(c, 'store_click', { gameId: 'demo-1', store: 'Steam' });
  // 그 앞 기간(8일 전) 기록
  clock -= 8 * 86400e3;
  await ev(c, 'visit', {}, 'oldvisitor1');
  clock += 8 * 86400e3;

  assert.equal((await c('GET', '/api/admin/metrics')).status, 401);
  const admin = client();
  await admin('POST', '/api/auth/signup', { loginId: 'boss', password: 'secret123', nickname: 'boss', email: 'boss@example.com' });
  await server.db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run('boss@example.com');
  await ev(admin, 'visit', {}, 'adminvisit1');
  const user = client();
  await user('POST', '/api/auth/signup', { loginId: 'plain', password: 'secret123', nickname: 'plain', email: 'plain@example.com' });
  assert.equal((await user('GET', '/api/admin/metrics')).status, 403);

  const { status, body } = await admin('GET', '/api/admin/metrics?days=7');
  assert.equal(status, 200);
  assert.equal(body.days, 7);
  assert.equal(body.current.visitors, 1, '관리자 기록은 빠짐');
  assert.equal(body.current.recClickRate, 100);
  assert.equal(body.current.storeRate, 100);
  assert.deepEqual(body.current.funnel.map((s) => s.n), [1, 1, 1, 1]);
  assert.equal(body.previous.visitors, 1, '8일 전 방문은 앞 기간');
  assert.equal((await admin('GET', '/api/admin/metrics?days=30')).body.current.visitors, 2);
});
