import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppStoreProvider, normCompany, sameCompany, matchApp, APPSTORE_SEARCH } from '../server/providers/appStoreProvider.js';

const APP = {
  trackName: '하루 한 판 퍼즐',
  sellerName: 'Haru Haneul Co., Ltd.',
  artistName: '하루하늘',
  artworkUrl512: 'https://is1-ssl.mzstatic.com/image/thumb/Purple/v4/ab/cd/icon/512x512bb.jpg',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Purple/v4/ab/cd/icon/100x100bb.jpg',
  trackViewUrl: 'https://apps.apple.com/kr/app/id123456789',
};
const reply = (results) => async () => ({ ok: true, status: 200, json: async () => ({ resultCount: results.length, results }) });

test('회사 이름 비교: (주)·주식회사·Co., Ltd. 무시', () => {
  assert.equal(normCompany('(주)쑨왕코리아'), '쑨왕코리아');
  assert.ok(sameCompany('주식회사 하루하늘', '하루하늘'));
  assert.ok(sameCompany('NEXON Korea Corporation', '(주)NEXON Korea'));
  assert.ok(!sameCompany('하루하늘', '다른회사'));
  assert.ok(!sameCompany('', '하루하늘'));
});

test('같은 앱 판단: 제목 + 개발사 모두 같을 때만', () => {
  assert.equal(matchApp([APP], { title: '하루 한 판 퍼즐', publisher: '하루하늘' }), APP, 'artistName 으로 일치');
  assert.equal(matchApp([APP], { title: '하루 한판 퍼즐 (모바일)', publisher: '(주)하루하늘' }), APP, '공백·괄호 표기 무시');
  assert.equal(matchApp([APP], { title: '하루 한 판 퍼즐', publisher: '다른게임사' }), null, '개발사 다르면 안 붙임');
  assert.equal(matchApp([APP], { title: '이틀 두 판 퍼즐', publisher: '하루하늘' }), null, '제목 다르면 안 붙임');
  assert.equal(matchApp([APP], { title: '하루 한 판 퍼즐', publisher: null }), null, '신청사 없으면 안 붙임');
});

test('요청 형식(한국 스토어·소프트웨어), 이미지·링크 주소 검증, 캐시', async () => {
  let url;
  let n = 0;
  const p = createAppStoreProvider({}, { fetchImpl: async (u) => { url = u; n++; return reply([APP])(); } });
  const r = await p.lookup({ title: '하루 한 판 퍼즐', publisher: '하루하늘' });
  assert.equal(`${url.origin}${url.pathname}`, APPSTORE_SEARCH);
  assert.equal(url.searchParams.get('country'), 'kr');
  assert.equal(url.searchParams.get('entity'), 'software');
  assert.equal(url.searchParams.get('term'), '하루 한 판 퍼즐');
  assert.deepEqual(r, { imageUrl: APP.artworkUrl512, storeUrl: APP.trackViewUrl, appName: APP.trackName, seller: APP.sellerName, screenshots: [] });
  await p.lookup({ title: '하루 한 판 퍼즐', publisher: '하루하늘' });
  assert.equal(n, 1, '캐시');
  const bad = createAppStoreProvider({}, { fetchImpl: reply([{ ...APP, trackViewUrl: 'https://evil.example/app', artworkUrl512: 'https://evil.example/x.jpg' }]) });
  assert.equal(await bad.lookup({ title: '하루 한 판 퍼즐', publisher: '하루하늘' }), null, '애플 주소가 아니면 안 붙임');
  const badImg = createAppStoreProvider({}, { fetchImpl: reply([{ ...APP, artworkUrl512: 'https://evil.example/x.jpg', artworkUrl100: null }]) });
  assert.equal((await badImg.lookup({ title: '하루 한 판 퍼즐', publisher: '하루하늘' })).imageUrl, null);
  assert.equal(await createAppStoreProvider({ enabled: false }).lookup({ title: 'a', publisher: 'b' }), null);
});

test('분당 15건 자체 제한: 넘으면 조회하지 않고 다음에 다시', async () => {
  let n = 0;
  let t = 0;
  const p = createAppStoreProvider({}, { now: () => t, fetchImpl: async () => { n++; return reply([])(); } });
  for (let i = 0; i < 20; i++) await p.lookup({ title: `게임${i}`, publisher: '회사' });
  assert.equal(n, 15);
  t = 61_000;
  await p.lookup({ title: '게임19', publisher: '회사' });
  assert.equal(n, 16, '1분 뒤 다시 조회');
});

test('스크린샷: 애플 이미지 서버만, 크기 읽기 · 카드는 세로, 배너는 가로, 상세 표지는 아이콘', async () => {
  const { screenshotsOf } = await import('../server/providers/appStoreProvider.js');
  const { pickArt } = await import('../server/services/appArt.js');
  const shots = screenshotsOf({
    screenshotUrls: ['https://is1-ssl.mzstatic.com/a/1242x2688bb.jpg', 'https://evil.example.com/x/100x100bb.jpg'],
    ipadScreenshotUrls: ['https://is2-ssl.mzstatic.com/b/2048x1536bb.png'],
  });
  assert.deepEqual(shots, [
    { url: 'https://is1-ssl.mzstatic.com/a/1242x2688bb.jpg', w: 1242, h: 2688 },
    { url: 'https://is2-ssl.mzstatic.com/b/2048x1536bb.png', w: 2048, h: 1536 },
  ]);
  const art = pickArt({ imageUrl: 'https://is1-ssl.mzstatic.com/icon.png', screenshots: shots });
  assert.equal(art.cover, shots[0].url, '카드: 세로 스크린샷');
  assert.equal(art.banner, shots[1].url, '배너: 가로 스크린샷');
  assert.equal(art.icon, 'https://is1-ssl.mzstatic.com/icon.png');
  assert.equal(pickArt({ imageUrl: 'https://is1-ssl.mzstatic.com/icon.png', screenshots: [] }).cover, 'https://is1-ssl.mzstatic.com/icon.png', '스크린샷 없으면 아이콘');
});
