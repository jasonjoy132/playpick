import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { validateSubmission } from '../server/community/submissions.js';

let server, base;
// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', adminEmails: ['boss@example.com'] }, { mailer: { configured: false, devLog: false, send: async () => {} } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'playpick', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : null, type: ct };
  };
  return { call };
}

const GAME = {
  title: '테스트 인디 퍼즐',
  originalTitle: 'Test Indie Puzzle',
  platforms: ['pc', 'mobile'],
  genres: ['puzzle'],
  playersMin: 1,
  playersMax: 2,
  storeUrl: 'https://store.steampowered.com/app/123456/',
  summary: '두 명이 함께 푸는 퍼즐 게임',
  publisher: '테스트 스튜디오',
  releaseYear: 2025,
};

test('제보 검증: 필수·범위·공식 스토어 주소만', () => {
  assert.equal(validateSubmission(GAME).storeUrl, 'https://store.steampowered.com/app/123456/');
  assert.throws(() => validateSubmission({ ...GAME, title: ' ' }), /게임 이름/);
  assert.throws(() => validateSubmission({ ...GAME, platforms: [] }), /플랫폼/);
  assert.throws(() => validateSubmission({ ...GAME, genres: ['zzz'] }), /장르/);
  assert.throws(() => validateSubmission({ ...GAME, playersMin: 3, playersMax: 2 }), /추천 인원/);
  assert.throws(() => validateSubmission({ ...GAME, playersMin: 1, playersMax: '' }), /추천 인원/);
  assert.throws(() => validateSubmission({ ...GAME, storeUrl: 'https://evil.example.com/steam' }), /공식 스토어/);
  assert.throws(() => validateSubmission({ ...GAME, storeUrl: 'javascript:alert(1)' }), /공식 스토어/);
  assert.throws(() => validateSubmission({ ...GAME, releaseYear: 1800 }), /출시 연도/);
  assert.equal(validateSubmission({ ...GAME, playersMin: '', playersMax: '', storeUrl: '' }).playersMin, null);
});

test('제보 → 관리자 승인 → 검색·상세·나만의 게임 찾기에 나옴, 거절 사유는 내 제보에', async () => {
  const anon = client();
  assert.equal((await anon.call('POST', '/api/submissions', GAME)).status, 401, '로그인한 사람만');

  const user = client();
  await user.call('POST', '/api/auth/signup', { loginId: 'reporter1', password: 'secret123', nickname: '제보자', email: 'rep@example.com' });
  const me = await user.call('GET', '/api/auth/me');
  assert.equal(me.body.user.isAdmin, false);
  const created = await user.call('POST', '/api/submissions', { ...GAME, image: PNG });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.status, 'pending');
  assert.match(created.body.item.imageUrl, /^\/submission-images\/s\d+-[a-f0-9]{16}\.png$/);
  const img = await fetch(base + created.body.item.imageUrl);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await user.call('POST', '/api/submissions', GAME)).status, 409, '같은 이름 중복 제보');
  const second = await user.call('POST', '/api/submissions', { ...GAME, title: '거절될 게임', storeUrl: '' });
  assert.equal(second.status, 201);

  // 승인 전: 검색에 안 나옴, 일반 회원은 관리자 API 불가
  assert.equal((await anon.call('GET', `/api/search?q=${encodeURIComponent('인디 퍼즐')}`)).body.games.filter((g) => g.source === '사용자 제보').length, 0);
  assert.equal((await user.call('GET', '/api/admin/submissions')).status, 403);
  assert.equal((await anon.call('GET', '/api/admin/submissions')).status, 401);

  const admin = client();
  const signed = await admin.call('POST', '/api/auth/signup', { loginId: 'boss_admin', password: 'secret123', nickname: '관리자', email: 'BOSS@example.com' });
  assert.equal(signed.body.user.isAdmin, true, 'ADMIN_EMAILS 대소문자 무시');
  const list = await admin.call('GET', '/api/admin/submissions?status=pending');
  assert.equal(list.body.counts.pending, 2);
  assert.equal(list.body.items[0].submitter, '제보자');

  const id = created.body.item.id;
  assert.equal((await admin.call('POST', `/api/admin/submissions/${second.body.item.id}/reject`, { reason: '' })).status, 400, '거절 사유 필수');
  assert.equal((await admin.call('POST', `/api/admin/submissions/${second.body.item.id}/reject`, { reason: '이미 있는 게임이에요' })).status, 200);
  const ok = await admin.call('POST', `/api/admin/submissions/${id}/approve`);
  assert.equal(ok.body.item.gameId, `user-${id}`);

  // 검색·상세
  const found = await anon.call('GET', `/api/search?q=${encodeURIComponent('인디퍼즐')}`);
  assert.equal(found.body.games[0].id, `user-${id}`);
  const detail = await anon.call('GET', `/api/games/user-${id}`);
  assert.equal(detail.body.game.title, '테스트 인디 퍼즐');
  assert.equal(detail.body.game.source, '사용자 제보');
  assert.equal(detail.body.game.submittedBy, '제보자');
  assert.deepEqual(detail.body.game.recommendedPlayers, { min: 1, max: 2, source: 'user' });
  assert.equal(detail.body.game.stores[0].name, 'Steam');

  // 나만의 게임 찾기 (데모 모드: 후보 목록 방식)
  const rec = await anon.call('GET', '/api/recommendations?players=2&platforms=pc&genres=puzzle');
  assert.ok(rec.body.fullMatches.some((x) => x.game.id === `user-${id}`));

  // 내 제보: 상태·거절 사유
  const mine = await user.call('GET', '/api/me/submissions');
  const byTitle = Object.fromEntries(mine.body.items.map((x) => [x.title, x]));
  assert.equal(byTitle['테스트 인디 퍼즐'].status, 'approved');
  assert.equal(byTitle['거절될 게임'].status, 'rejected');
  assert.equal(byTitle['거절될 게임'].rejectReason, '이미 있는 게임이에요');
  assert.equal((await user.call('DELETE', `/api/me/submissions/${id}`)).status, 409, '검토 끝난 제보는 취소 불가');

  // 찜·리뷰도 동작
  assert.equal((await user.call('PUT', `/api/wishlist/user-${id}`)).status, 200);

  // 승인 취소(내리기)
  await admin.call('POST', `/api/admin/submissions/${id}/reject`, { reason: '정보가 틀려서 내렸어요' });
  assert.equal((await anon.call('GET', `/api/games/user-${id}`)).status, 404);
});

test('검토 중 제보 취소, 다른 사람 제보는 취소 불가, 표지 이미지 검사', async () => {
  const a = client();
  await a.call('POST', '/api/auth/signup', { loginId: 'reporter2', password: 'secret123', nickname: '제보자둘', email: 'r2@example.com' });
  const b = client();
  await b.call('POST', '/api/auth/signup', { loginId: 'reporter3', password: 'secret123', nickname: '제보자셋', email: 'r3@example.com' });
  const bad = await a.call('POST', '/api/submissions', { ...GAME, title: '가짜 이미지', image: 'data:image/png;base64,AAAA' });
  assert.equal(bad.status, 400);
  const r = await a.call('POST', '/api/submissions', { ...GAME, title: '취소할 게임' });
  assert.equal((await b.call('DELETE', `/api/me/submissions/${r.body.item.id}`)).status, 404);
  assert.equal((await a.call('DELETE', `/api/me/submissions/${r.body.item.id}`)).status, 200);
  assert.equal((await a.call('GET', '/api/me/submissions')).body.items.length, 0);
});

test('뱃지·칭호: 승인 수로 계산, 리뷰·상세에 표시, 대표 칭호 고르기, 내리면 빠짐', async () => {
  const u = client();
  await u.call('POST', '/api/auth/signup', { loginId: 'badge_user', password: 'secret123', nickname: '뱃지왕', email: 'badge@example.com' });
  let b = (await u.call('GET', '/api/me/badges')).body;
  assert.equal(b.display, null, '처음엔 칭호 없음');
  assert.equal(b.next.id, 'finder');

  const admin = client();
  await admin.call('POST', '/api/auth/login', { loginId: 'boss_admin', password: 'secret123' });
  const ids = [];
  for (const t of ['뱃지 게임 하나', '뱃지 게임 둘', '뱃지 게임 셋']) {
    const r = await u.call('POST', '/api/submissions', { ...GAME, title: t, platforms: ['mobile'], image: PNG });
    ids.push(r.body.item.id);
    await admin.call('POST', `/api/admin/submissions/${r.body.item.id}/approve`);
  }
  b = (await u.call('GET', '/api/me/badges')).body;
  const earned = b.badges.filter((x) => x.earned).map((x) => x.id);
  assert.deepEqual(earned.sort(), ['digger', 'early', 'finder'].sort(), '승인 3개 → 첫 발견자·게임 발굴단 + 2026년 첫 승인');
  assert.equal(b.display.id, 'digger', '자동으로 가장 높은 단계');
  assert.equal(b.next.id, 'hunter');
  assert.equal((await u.call('GET', '/api/auth/me')).body.user.badge.name, '게임 발굴단');

  // 다른 회원 리뷰 → 개척자, 리뷰 목록에 제보자 뱃지
  const other = client();
  await other.call('POST', '/api/auth/signup', { loginId: 'reviewer9', password: 'secret123', nickname: '리뷰어', email: 'rv@example.com' });
  await other.call('PUT', `/api/games/user-${ids[0]}/reviews/mine`, { rating: 5, content: '좋아요' });
  await u.call('PUT', `/api/games/user-${ids[0]}/reviews/mine`, { rating: 4, content: '제가 제보했어요' });
  const rv = (await other.call('GET', `/api/games/user-${ids[0]}/reviews`)).body.reviews;
  assert.equal(rv.find((x) => x.nickname === '뱃지왕').badge.name, '게임 발굴단');
  assert.equal(rv.find((x) => x.nickname === '리뷰어').badge.name, '새내기 리뷰어', '리뷰만 쓴 회원은 리뷰 칭호');
  assert.ok((await u.call('GET', '/api/me/badges')).body.badges.find((x) => x.id === 'pioneer').earned);

  // 상세: 제보자 뱃지, 내부 id는 응답에 없음
  const d = (await other.call('GET', `/api/games/user-${ids[1]}`)).body.game;
  assert.equal(d.submitterBadge.id, 'digger');
  assert.equal(d.submittedById, undefined);

  // 대표 칭호 고르기
  assert.equal((await u.call('PUT', '/api/me/badges/selected', { id: 'hunter' })).status, 400, '안 받은 뱃지는 불가');
  assert.equal((await u.call('PUT', '/api/me/badges/selected', { id: 'early' })).body.display.id, 'early');
  assert.equal((await u.call('PUT', '/api/me/badges/selected', { id: null })).body.display.id, 'digger');

  // 내리면 다시 계산
  await admin.call('POST', `/api/admin/submissions/${ids[2]}/reject`, { reason: '중복' });
  assert.equal((await u.call('GET', '/api/me/badges')).body.display.id, 'finder');
});

test('리뷰 업적: 리뷰 수 단계 칭호, 정성 리뷰어, 첫 마디(그 게임 첫 리뷰), 자동 칭호는 더 높은 단계', async () => {
  const u = client();
  await u.call('POST', '/api/auth/signup', { loginId: 'reviewer_pro', password: 'secret123', nickname: '평론가', email: 'pro@example.com' });
  let b = (await u.call('GET', '/api/me/badges')).body;
  assert.equal(b.nextReview.id, 'rv1');
  const long = '정말 재미있게 했어요. '.repeat(10); // 100자 넘는 리뷰
  const games = ['demo-01', 'demo-02', 'demo-03', 'demo-04', 'demo-05'];
  for (const id of games) assert.equal((await u.call('PUT', `/api/games/${id}/reviews/mine`, { rating: 4, content: long })).status, 200);
  b = (await u.call('GET', '/api/me/badges')).body;
  const earned = new Set(b.badges.filter((x) => x.earned).map((x) => x.id));
  assert.ok(earned.has('rv1') && earned.has('rv2'), '리뷰 5개 → 새내기 리뷰어·한줄 평론가');
  assert.equal(b.display.id, 'rv2', '제보 칭호가 없으면 리뷰 칭호가 자동');
  assert.equal(b.badges.find((x) => x.id === 'essay').have, 5, '정성 리뷰 5/10');
  assert.equal(b.stats.firstReviews >= 3, true, '데모 게임에 처음 쓴 리뷰');
  assert.ok(earned.has('firstword'));
  assert.equal(b.nextReview.id, 'rv3');
  // 리뷰를 지우면 다시 계산
  await u.call('DELETE', '/api/games/demo-05/reviews/mine');
  assert.equal((await u.call('GET', '/api/me/badges')).body.display.id, 'rv1');
});

test('칭호 알림: 새로 받은 뱃지를 알려 주고, 확인하면 다시 안 알림', async () => {
  const u = client();
  const r = await u.call('POST', '/api/auth/signup', { loginId: 'notify_me', password: 'secret123', nickname: '알림왕', email: 'nt@example.com' });
  assert.deepEqual(r.body.user.newBadges, []);
  await u.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 5, content: '' });
  let me = (await u.call('GET', '/api/auth/me')).body.user;
  const ids = me.newBadges.map((b) => b.id);
  assert.ok(ids.includes('rv1'), '새내기 리뷰어 알림');
  assert.equal(me.newBadges.find((b) => b.id === 'rv1').image, '/badge-rv1.webp');
  assert.ok(me.newBadges[0].desc);
  // 확인 전에는 계속 알림
  assert.ok((await u.call('GET', '/api/auth/me')).body.user.newBadges.length > 0);
  await u.call('POST', '/api/me/badges/seen', { ids: [...ids, 'curator'] }); // 안 받은 뱃지는 무시
  me = (await u.call('GET', '/api/auth/me')).body.user;
  assert.deepEqual(me.newBadges, []);
  // 리뷰를 지워 칭호를 잃었다가 다시 쓰면 다시 알림
  await u.call('DELETE', '/api/games/demo-01/reviews/mine');
  assert.deepEqual((await u.call('GET', '/api/auth/me')).body.user.newBadges, [], '잃은 동안은 알림 없음');
  await u.call('PUT', '/api/games/demo-01/reviews/mine', { rating: 4, content: '' });
  assert.ok((await u.call('GET', '/api/auth/me')).body.user.newBadges.some((b) => b.id === 'rv1'), '다시 얻으면 다시 알림');
});
