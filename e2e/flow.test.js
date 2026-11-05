// E2E: 조건 설정 → 추천 목록 → 상세 → 구매처 이동, 그리고 로딩/결과 없음/오류 상태
// 실행: npm run build && npm run test:e2e   (playwright + chromium 필요)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { createRawgPlaytime } from '../server/services/rawgPlaytime.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

let server, base, browser;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

for (const vp of [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]) {
  test(`[${vp.name}] 조건 설정 → 추천 목록 → 상세 → 구매처 이동`, async () => {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, locale: 'ko-KR' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);

    // 0. 첫 화면: 캐러셀 + 게임 목록
    await page.getByTestId('carousel').waitFor();
    assert.ok((await page.getByTestId('game-card').count()) > 0);
    await shot(page, `${vp.name}-0-home`);

    // 1. 조건 설정 (나만의 게임 찾기 → 창)
    await page.getByTestId('open-finder').click();
    const finder = page.getByTestId('finder');
    await finder.waitFor();
    const submit = finder.getByRole('button', { name: '추천 게임 찾기' });
    assert.equal(await submit.isDisabled(), true, '조건 없으면 비활성');
    await finder.getByLabel('2명').check();
    await finder.getByLabel('PC', { exact: true }).check();
    await finder.getByLabel('롤플레잉').check();
    await shot(page, `${vp.name}-1-criteria`);
    await submit.click();
    assert.equal(await page.getByTestId('finder').count(), 0, '제출하면 창 닫힘');

    // 2~3. 매칭 → 추천 목록
    await page.waitForURL(/\/results\?players=2&platforms=pc&genres=rpg/);
    await page.getByTestId('result-count').waitFor();
    const full = page.getByTestId('section-full').getByTestId('game-card');
    assert.ok((await full.count()) >= 1, '전체 일치 게임 존재');
    const partial = page.getByTestId('section-partial').getByTestId('game-card');
    assert.ok((await partial.count()) >= 1, '일부 일치 게임 존재');
    // 일부 일치 카드에는 불일치/정보 없음 배지가 있어야 함
    const firstPartialBadges = await partial.first().locator('.match-badge').evaluateAll((els) => els.map((e) => e.dataset.status));
    assert.ok(firstPartialBadges.includes('match'));
    assert.ok(firstPartialBadges.some((s) => s !== 'match'));
    await shot(page, `${vp.name}-2-results`);

    // 4. 상세 페이지
    // 조건 변경 → 기존 조건이 채워진 창
    await page.getByTestId('edit-criteria').click();
    assert.equal(await page.getByTestId('finder').getByLabel('롤플레잉').isChecked(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByTestId('finder').count(), 0, 'Esc로 닫힘');
    await full.filter({ hasText: '던전 동맹' }).getByRole('link').click();
    await page.waitForURL(/\/games\/demo-02\?/);
    const detail = page.getByTestId('game-detail');
    await detail.waitFor();
    assert.match(await detail.textContent(), /1~4명/);
    assert.match(await detail.textContent(), /모든 조건 일치/);
    await shot(page, `${vp.name}-3-detail`);

    // 5. 구매처 이동 (새 창)
    const link = page.getByTestId('store-link');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    const [popup] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
    await popup.getByTestId('demo-store').waitFor();
    assert.match(popup.url(), /\/demo-store\/demo-02$/);
    await shot(popup, `${vp.name}-4-store`);

    // 뒤로: 추천 목록으로
    await page.getByRole('link', { name: /추천 목록으로/ }).click();
    await page.waitForURL(/\/results\?/);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('정보 없음 표시: 인원·플랫폼·구매처 데이터가 없는 게임', async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/games/demo-15`);
  const text = await page.getByTestId('game-detail').textContent();
  assert.match(text, /플레이 인원정보 없음/);
  assert.match(text, /장르정보 없음/);
  await page.getByTestId('no-store').waitFor();
  assert.equal(await page.getByTestId('store-link').count(), 0);
  await page.close();
});

test('검색 중(로딩) 상태와 결과 없음 상태', async () => {
  const page = await browser.newPage();
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route('**/api/recommendations?**', async (route) => {
    await gate;
    await route.fulfill({ json: { meta: { isDemo: true, sources: ['데모 데이터'] }, criteria: {}, totalGames: 16, fullMatches: [], partialMatches: [] } });
  });
  await page.goto(`${base}/results?players=5&genres=sports`);
  await page.getByTestId('state-loading').waitFor();
  await shot(page, 'state-loading');
  release();
  await page.getByTestId('state-empty').waitFor();
  await shot(page, 'state-empty');
  await page.close();
});

test('데이터/API 오류 상태 + 다시 시도', async () => {
  const page = await browser.newPage();
  let fail = true;
  await page.route('**/api/recommendations?**', (route) =>
    fail
      ? route.fulfill({ status: 502, json: { error: { code: 'UPSTREAM_ERROR', message: '게임물관리위원회 API 오류 [0011]: 요청 변수 중 필수값이 지정되지 않았습니다.' } } })
      : route.continue(),
  );
  await page.goto(`${base}/results?platforms=pc`);
  const err = page.getByTestId('state-error');
  await err.waitFor();
  assert.match(await err.textContent(), /게임물관리위원회 API 오류 \[0011\]/);
  await shot(page, 'state-error');
  fail = false;
  await page.getByRole('button', { name: '다시 시도' }).click();
  await page.getByTestId('result-count').waitFor();
  await page.close();
});

test('전체 일치 0건이면 안내 문구 + 일부 일치 목록 표시(실제 서버 응답)', async () => {
  const page = await browser.newPage();
  // 모바일 + 스포츠를 모두 만족하는 데모 게임은 없지만, 하나씩 일치하는 게임은 있음
  await page.goto(`${base}/results?platforms=mobile&genres=sports`);
  await page.getByTestId('result-count').waitFor();
  assert.equal(await page.getByTestId('section-full').getByTestId('game-card').count(), 0);
  await page.locator('.section-empty').waitFor();
  assert.ok((await page.getByTestId('section-partial').getByTestId('game-card').count()) >= 2);
  await page.close();
});

test('API 키가 브라우저 번들에 포함되지 않음', async () => {
  const js = await (await fetch(`${base}/app.js`)).text();
  assert.ok(!/KR_GAME_DB_API_KEY|serviceKey/.test(js));
});

test('live 모드 화면(게임위 가이드 샘플 응답): 데모 배너 없음, 인원 정보 없음, 구매처 정보 없음', async () => {
  const { GUIDE_SAMPLE } = await import('../test/fixtures.js');
  // 메모리 DB 사용(실제 .data 건드리지 않음). 샘플 게임은 AI 데이터에 없어 '모름' → 숨김 규칙 끔
  const live = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:', hideUnknownGrac: false }, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => GUIDE_SAMPLE }) });
  await new Promise((r) => live.listen(0, r));
  const b = `http://127.0.0.1:${live.address().port}`;
  const page = await browser.newPage();
  try {
    await page.goto(`${b}/results?players=2&platforms=pc&genres=action`);
    await page.getByTestId('result-count').waitFor();
    assert.equal(await page.getByTestId('demo-banner').count(), 0);
    const card = page.getByTestId('game-card').first();
    assert.match(await card.textContent(), /게임물명2/);
    assert.match(await card.textContent(), /인원수 정보 없음/);
    await shot(page, 'live-results');
    await card.getByRole('link').click();
    await page.getByTestId('no-store').waitFor();
    const text = await page.getByTestId('game-detail').textContent();
    assert.match(text, /청소년이용불가/);
    assert.match(text, /게임물관리위원회/);
    await shot(page, 'live-detail');
  } finally {
    await page.close();
    live.close();
  }
});

test('live + IGDB 화면: 게임위에 없는 게임은 IGDB로 표시(국내 등급 정보 없음, 실제 스토어 링크)', async () => {
  const { GUIDE_SAMPLE } = await import('../test/fixtures.js');
  const igdbGame = {
    id: 101, name: 'Test Kitchen', summary: 'A co-op cooking game.', url: 'https://www.igdb.com/games/test-kitchen',
    genres: [{ id: 10, name: 'Puzzle' }], platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }],
    game_modes: [{ name: 'Single player' }, { name: 'Multiplayer' }], multiplayer_modes: [{ offlinemax: 4 }],
    websites: [{ url: 'https://store.steampowered.com/app/1/' }],
  };
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('grac.or.kr')) return reply(u.includes('gametitle') ? '<result><tcount>0</tcount><pageno>1</pageno></result>' : GUIDE_SAMPLE);
    if (u.includes('oauth2/token')) return reply({ access_token: 't', expires_in: 3600 });
    if (u.endsWith('/genres')) return reply([{ id: 10, name: 'Puzzle' }]);
    if (u.endsWith('/platforms')) return reply([{ id: 6, name: 'PC (Microsoft Windows)' }]);
    if (u.endsWith('/games')) return reply([igdbGame]);
    throw new Error(u);
  };
  const live = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:', igdb: { clientId: 'id', clientSecret: 'secret' } }, { fetchImpl });
  await new Promise((r) => live.listen(0, r));
  const b = `http://127.0.0.1:${live.address().port}`;
  const page = await browser.newPage();
  try {
    await page.goto(`${b}/results?players=2&platforms=pc&genres=puzzle`);
    const full = page.getByTestId('section-full').getByTestId('game-card');
    await full.first().waitFor();
    const text = await full.first().textContent();
    assert.match(text, /Test Kitchen/);
    assert.doesNotMatch(text, /국내 등급 정보 없음/, '목록에서는 확인 전 단정하지 않음');
    assert.match(text, /1~4명/);
    await shot(page, 'igdb-results');
    await full.first().getByRole('link').click();
    const link = page.getByTestId('store-link');
    assert.equal(await link.getAttribute('href'), 'https://store.steampowered.com/app/1/');
    const detailText = await page.getByTestId('game-detail').textContent();
    assert.match(detailText, /국내 등급분류 정보 없음/);
    assert.match(detailText, /같은 제목의 게임을 찾지 못했습니다/);
    await shot(page, 'igdb-detail');
  } finally {
    await page.close();
    live.close();
  }
});

test('결과가 많으면 24개씩 더 보기', async () => {
  const page = await browser.newPage();
  const many = Array.from({ length: 30 }, (_, i) => ({
    game: { id: `demo-x${i}`, title: `게임 ${i}`, isDemo: true, players: null, platforms: ['pc'], genres: null, stores: [] },
    evaluation: { checks: [{ key: 'platforms', label: '플랫폼', status: 'match', matched: ['PC'] }], matchedCount: 1, mismatchCount: 0, unknownCount: 0, totalCount: 1, isFullMatch: true },
  }));
  await page.route('**/api/recommendations?**', (route) =>
    route.fulfill({ json: { meta: { isDemo: true, sources: ['데모 데이터'] }, criteria: {}, totalGames: 30, warnings: [], fullMatches: many, partialMatches: [] } }),
  );
  await page.goto(`${base}/results?platforms=pc`);
  const cards = page.getByTestId('section-full').getByTestId('game-card');
  await cards.first().waitFor();
  assert.equal(await cards.count(), 24);
  // dispatchEvent: 스크롤하지 않고 눌러 자동 불러오기와 겹치지 않게
  await page.getByTestId('more-full').dispatchEvent('click');
  assert.equal(await cards.count(), 30);
  assert.equal(await page.getByTestId('more-full').count(), 0);
  await page.close();
});

test('게임명 검색: 결과 → 상세, 결과 없음', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  const box = page.getByRole('searchbox', { name: '게임명 검색' });
  await box.fill('던전');
  await box.press('Enter');
  await page.waitForURL(/\/search\?q=/);
  await page.getByTestId('result-count').waitFor();
  const cards = page.getByTestId('game-card');
  assert.equal(await cards.count(), 1);
  await shot(page, 'search');
  await cards.first().getByRole('link').click();
  await page.getByTestId('game-detail').waitFor();
  await page.goto(`${base}/search?q=${encodeURIComponent('없는게임이름')}`);
  await page.getByTestId('state-empty').waitFor();
  await page.close();
});

test('번역된 소개 표시 + 원문 보기 (DeepL 응답 모의)', async () => {
  const { GUIDE_SAMPLE } = await import('../test/fixtures.js');
  const igdbGame = {
    id: 101, name: 'Test Kitchen', summary: 'A co-op cooking game.', genres: [{ id: 10, name: 'Puzzle' }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }], game_modes: [{ name: 'Single player' }],
    total_rating: 84, total_rating_count: 250, rating: 82, rating_count: 230, aggregated_rating: 88, aggregated_rating_count: 20,
  };
  const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('grac.or.kr')) return reply(u.includes('gametitle') ? '<result><tcount>0</tcount><pageno>1</pageno></result>' : GUIDE_SAMPLE);
    if (u.includes('oauth2/token')) return reply({ access_token: 't', expires_in: 3600 });
    if (u.includes('deepl.com')) return reply({ translations: [{ text: '협동 요리 게임입니다.', detected_source_language: 'EN' }] });
    if (u.endsWith('/games')) return reply([igdbGame]);
    throw new Error(u); // RAWG(api.rawg.io)를 실시간으로 부르면 여기서 실패
  };
  // RAWG 플레이 시간은 미리 받아 둔 파일(rawg-playtime.json)에서만 읽음
  const rawgPlaytime = createRawgPlaytime(null, { entries: { 'igdb-101': { hours: 7, url: 'https://rawg.io/games/test-kitchen', name: 'Test Kitchen' } } });
  const live = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:', igdb: { clientId: 'id', clientSecret: 's' }, deepl: { apiKey: 'k:fx' }, rawg: { apiKey: 'r' } }, { fetchImpl, rawgPlaytime });
  await new Promise((r) => live.listen(0, r));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${live.address().port}/games/igdb-101`);
    const summary = page.getByTestId('summary');
    await summary.waitFor();
    assert.equal((await summary.textContent()).trim(), '협동 요리 게임입니다.');
    await page.getByRole('button', { name: '원문 보기' }).click();
    assert.equal((await summary.textContent()).trim(), 'A co-op cooking game.');
    // 글로벌 평점(84/100 → 4.2) 과 회원 평점 비교
    const cmp = page.getByTestId('rating-compare');
    assert.equal((await cmp.getByTestId('global-avg').textContent()).trim(), '4.2');
    assert.match(await cmp.textContent(), /IGDB 250개 평가/);
    assert.match(await cmp.textContent(), /IGDB 이용자 4\.1.*평론가 4\.4/s);
    assert.match(await cmp.textContent(), /아직 평가가 없어요/);
    assert.match(await page.locator('.detail-actions').textContent(), /글로벌.*4\.2/s);
    // 서비스 상태 대신 평균 플레이 시간 + RAWG 출처 링크
    const info = page.locator('.info-table');
    assert.match(await info.textContent(), /평균 플레이 시간약 7시간/);
    assert.doesNotMatch(await info.textContent(), /서비스 상태/);
    assert.equal(await info.getByRole('link', { name: 'RAWG' }).getAttribute('href'), 'https://rawg.io/games/test-kitchen');
  } finally {
    await page.close();
    live.close();
  }
});

test('상단 메뉴: 홈·인기 게임·신작·평점 랭킹·장르별 게임 이동과 필터', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const nav = page.getByRole('navigation', { name: '주 메뉴' });
  await nav.getByRole('link', { name: '인기 게임' }).click();
  await page.waitForURL(/\/popular$/);
  const grid = page.getByTestId('browse-grid');
  await grid.waitFor();
  const all = await grid.getByTestId('game-card').count();
  assert.equal(await page.getByRole('group', { name: '플랫폼' }).getByRole('button', { name: '아케이드' }).count(), 0, '아케이드는 고를 수 없음');
  await page.getByRole('group', { name: '플랫폼' }).getByRole('button', { name: '모바일' }).click();
  await page.waitForURL(/platform=mobile/);
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid=browse-grid] [data-testid=game-card]').length < n, all);
  assert.equal(await nav.getByRole('link', { name: '인기 게임' }).getAttribute('aria-current'), 'page');

  await nav.getByRole('link', { name: '장르별 게임' }).click();
  await page.waitForURL(/\/genres$/);
  await page.getByRole('navigation', { name: '장르' }).getByRole('link', { name: '퍼즐' }).click();
  await page.waitForURL(/\/genres\/puzzle/);
  await page.getByRole('heading', { name: '퍼즐 게임' }).waitFor();
  await page.getByTestId('browse-grid').waitFor();

  await nav.getByRole('link', { name: '신작·출시 예정' }).click();
  await page.getByTestId('warnings').waitFor(); // 데모 데이터엔 출시일이 없음 → 안내
  await page.getByRole('tab', { name: '출시 예정' }).click();
  await page.waitForURL(/tab=upcoming/);

  await nav.getByRole('link', { name: '평점 랭킹' }).click();
  await page.getByRole('tab', { name: '회원 평점 TOP' }).click();
  await page.waitForURL(/tab=members/);
  await page.getByTestId('browse-empty').waitFor();

  await nav.getByRole('link', { name: '홈' }).click();
  await page.getByRole('link', { name: '더 보기 →' }).click();
  await page.waitForURL(/\/popular$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('검색: IGDB 결과가 있으면 같은 게임의 게임위 항목은 보여 주지 않음', async () => {
  const pubg = { id: 27789, name: 'PUBG: Battlegrounds', alternative_names: [{ name: '배틀그라운드', comment: 'Korean title' }], summary: 'Battle royale.', platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }], genres: [{ id: 5, name: 'Shooter' }] };
  const grac = `<result><tcount>1</tcount><pageno>1</pageno><item><rateno>CC-OL-B1</rateno><rateddate>2017-11-01</rateddate><gametitle>배틀그라운드</gametitle><entname>크래프톤</entname><givenrate>청소년이용불가</givenrate><genre>FPS/TPS</genre><platform>PC/온라인 게임</platform><cancelstatus>False</cancelstatus></item></result>`;
  const reply = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => b });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('grac.or.kr')) return reply(grac);
    if (u.includes('oauth2/token')) return reply({ access_token: 't', expires_in: 3600 });
    if (u.endsWith('/games')) return reply([pubg]);
    throw new Error(u);
  };
  const live = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:', igdb: { clientId: 'id', clientSecret: 's' }, deepl: {}, rawg: {} }, { fetchImpl });
  await new Promise((r) => live.listen(0, r));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${live.address().port}/search?q=${encodeURIComponent('배틀그라운드')}`);
    await page.getByTestId('result-count').waitFor();
    assert.equal(await page.getByTestId('game-card').count(), 1);
    assert.match(await page.getByTestId('game-card').textContent(), /PUBG/);
    assert.equal(await page.getByTestId('show-grac').count(), 0, '게임위 더 보기 버튼 없음');
  } finally {
    await page.close();
    live.close();
  }
});

test('게임위 전용 게임 상세: App Store에서 같은 앱을 찾으면 아이콘·App Store 링크 표시', async () => {
  const grac = `<result><tcount>1</tcount><pageno>1</pageno><item><rateno>SC-OM-1</rateno><rateddate>2026-10-28</rateddate><gametitle>하루 한 판 퍼즐</gametitle><entname>하루하늘</entname><givenrate>전체이용가</givenrate><genre>퍼즐</genre><platform>모바일 게임</platform><cancelstatus>False</cancelstatus></item></result>`;
  const app = { trackName: '하루 한 판 퍼즐', artistName: '하루하늘', artworkUrl512: 'https://is1-ssl.mzstatic.com/x/512x512bb.jpg', trackViewUrl: 'https://apps.apple.com/kr/app/id1' };
  const reply = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => b });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('grac.or.kr')) return reply(grac);
    if (u.includes('itunes.apple.com')) return reply({ resultCount: 1, results: [app] });
    throw new Error(u);
  };
  const live = createApp({ ...getConfig(), dataSource: 'live', dbFile: ':memory:', igdb: {}, deepl: {}, rawg: {}, appStore: { enabled: true } }, { fetchImpl });
  await new Promise((r) => live.listen(0, r));
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${live.address().port}/games/grac-SC-OM-1`);
    await page.getByTestId('game-detail').waitFor();
    assert.equal(await page.locator('.detail-cover img').getAttribute('src'), app.artworkUrl512);
    assert.equal(await page.getByTestId('appstore-link').getAttribute('href'), app.trackViewUrl);
    assert.match(await page.locator('.image-credit').textContent(), /App Store/);
    assert.match(await page.getByTestId('store-link').textContent(), /App Store에서 다운로드/);
  } finally {
    await page.close();
    live.close();
  }
});
