// E2E: 회원가입 → 로그인 상태 → 찜 → 찜 목록 → 별점·리뷰 → 로그아웃 → 로그인, 아이디·비밀번호 찾기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const mails = [];
let server, base, browser;

before(async () => {
  const mailer = { configured: true, devLog: false, send: async (m) => mails.push(m) };
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' }, { mailer });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('회원가입 → 찜 → 리뷰 → 로그아웃 → 로그인', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  // 로그인 전: 첫 화면 오른쪽 로그인 창, 하트 누르면 로그인 화면으로
  await page.getByTestId('login-panel').waitFor();
  await page.getByTestId('wish-button').first().click();
  await page.waitForURL(/\/login\?next=/);

  await page.goto(`${base}/signup`);
  await page.fill('#f-loginId', 'tester_1');
  await page.fill('#f-password', 'pass1234');
  await page.fill('#f-password2', 'pass9999');
  await page.getByRole('button', { name: '가입하기' }).click();
  await page.getByText('비밀번호 확인이 일치하지 않습니다.').waitFor();
  await page.fill('#f-password2', 'pass1234');
  await page.fill('#f-nickname', '테스터');
  await page.fill('#f-email', 'tester@example.com');
  await page.getByRole('button', { name: '가입하기' }).click();
  await page.waitForURL(`${base}/`);
  await page.getByTestId('profile-panel').waitFor();
  assert.match(await page.getByTestId('profile-panel').textContent(), /테스터님/);

  // 찜
  const heart = page.getByTestId('game-card').first().getByTestId('wish-button');
  await heart.click();
  await page.waitForFunction(() => document.querySelector('[data-testid=game-card] [data-testid=wish-button]').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => document.querySelector('[data-testid=pp-wish] b')?.textContent === '1');
  const title = await page.getByTestId('game-card').first().locator('.tile-title').textContent();
  await page.getByTestId('pp-wish').click();
  await page.waitForURL(/\/mypage\/wishlist/);
  await page.getByTestId('wishlist').waitFor();
  assert.match(await page.getByTestId('wishlist').textContent(), new RegExp(title.trim()));

  // 리뷰
  await page.getByTestId('wishlist').getByRole('link').first().click();
  await page.getByTestId('reviews').waitFor();
  await page.getByTestId('write-review').click();
  await page.getByRole('button', { name: '등록하기' }).click();
  await page.getByText('별점을 선택해 주세요.').waitFor();
  await page.locator('.stars-input label').nth(4).click();
  await page.fill('#review-text', '정말 재밌어요');
  await page.getByRole('button', { name: '등록하기' }).click();
  await page.getByTestId('review-item').waitFor();
  assert.equal((await page.getByTestId('rating-avg').textContent()).trim(), '5.0');
  assert.match(await page.getByTestId('review-item').textContent(), /테스터.*정말 재밌어요/s);

  // 로그아웃 → 로그인
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  await page.getByTestId('header-login').waitFor();
  await page.goto(base);
  const panel = page.getByTestId('login-panel');
  await panel.getByPlaceholder('아이디').fill('tester_1');
  await panel.getByPlaceholder('비밀번호').fill('wrongpass1');
  await panel.getByRole('button', { name: '로그인' }).click();
  await panel.getByText('아이디 또는 비밀번호가 올바르지 않습니다.').waitFor();
  await panel.getByPlaceholder('비밀번호').fill('pass1234');
  await panel.getByRole('button', { name: '로그인' }).click();
  await page.getByTestId('profile-panel').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('아이디 찾기·비밀번호 재설정 화면', async () => {
  mails.length = 0;
  const page = await browser.newPage();
  await page.goto(`${base}/find-id`);
  await page.fill('#f-email', 'tester@example.com');
  await page.getByRole('button', { name: '아이디 받기' }).click();
  await page.getByTestId('mail-done').waitFor();
  assert.ok(mails[0].lines.join(' ').includes('tester_1'));

  await page.goto(`${base}/find-password`);
  await page.fill('#f-loginId', 'tester_1');
  await page.fill('#f-email', 'tester@example.com');
  await page.getByRole('button', { name: '재설정 링크 받기' }).click();
  await page.getByTestId('mail-done').waitFor();
  const link = new URL(mails[1].link);
  await page.goto(`${base}${link.pathname}${link.search}`);
  await page.fill('#f-new-password', 'newpass123');
  await page.fill('#f-new-password2', 'newpass123');
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  await page.getByText('비밀번호를 바꿨어요').waitFor();
  await page.goto(`${base}/login`);
  const panel = page.getByTestId('login-panel');
  await panel.getByPlaceholder('아이디').fill('tester_1');
  await panel.getByPlaceholder('비밀번호').fill('newpass123');
  await panel.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(`${base}/`);
  await page.close();
});

test('마이페이지: 프로필 이미지·닉네임·비밀번호, 내 리뷰 삭제, 최근 본 게임', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${base}/signup`);
  await page.fill('#f-loginId', 'mypage_u');
  await page.fill('#f-password', 'mypage123');
  await page.fill('#f-password2', 'mypage123');
  await page.fill('#f-nickname', '마이');
  await page.fill('#f-email', 'my@example.com');
  await page.getByRole('button', { name: '가입하기' }).click();
  await page.waitForURL(`${base}/`);

  // 헤더 프로필 → 마이페이지
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: '마이페이지' }).click();
  await page.getByTestId('mypage-profile').waitFor();

  // 프로필 이미지 (브라우저에서 만든 PNG 업로드 → 256px로 줄여 저장)
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#3e6f70'; x.fillRect(0, 0, 400, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByTestId('avatar-input').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByText('프로필 이미지를 바꿨어요.').waitFor();
  const src = await page.locator('.avatar-xl img').getAttribute('src');
  assert.match(src, /^\/avatars\//);
  assert.equal(await page.locator('[data-testid=user-menu] img').getAttribute('src'), src, '헤더에도 반영');

  // 닉네임
  await page.fill('#f-nick', '마이닉');
  await page.getByRole('button', { name: '닉네임 저장' }).click();
  await page.getByText('닉네임을 바꿨어요.').waitFor();
  assert.match(await page.locator('.mypage-name').textContent(), /마이닉/);

  // 비밀번호
  await page.getByRole('link', { name: '비밀번호 변경' }).click();
  await page.fill('#f-cur', 'wrong1234');
  await page.fill('#f-new', 'changed123');
  await page.fill('#f-new2', 'changed123');
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  await page.getByText('현재 비밀번호가 올바르지 않습니다.').waitFor();
  await page.fill('#f-cur', 'mypage123');
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  await page.getByText('비밀번호를 바꿨어요.', { exact: false }).waitFor();

  // 게임 2개 보기 + 리뷰 1개 (리뷰는 수정 불가 → 삭제 버튼만)
  await page.goto(`${base}/games/demo-04`);
  await page.getByTestId('reviews').waitFor();
  await page.goto(`${base}/games/demo-07`);
  await page.getByTestId('write-review').click();
  await page.locator('.stars-input label').nth(2).click();
  await page.fill('#review-text', '전략 좋아요');
  await page.getByRole('button', { name: '등록하기' }).click();
  await page.getByTestId('delete-review').waitFor();
  assert.equal(await page.getByTestId('write-review').count(), 0, '작성 후에는 수정 버튼 없음');
  const reviewAvatar = await page.locator('[data-testid=review-item] .avatar img').getAttribute('src');
  assert.equal(reviewAvatar, src, '리뷰에 프로필 이미지');

  // 최근 본 게임
  await page.goto(`${base}/mypage/recent`);
  const rows = page.getByTestId('recent').getByTestId('game-row');
  await rows.first().waitFor();
  assert.match(await rows.first().textContent(), /왕국의 수/);
  assert.match(await rows.nth(1).textContent(), /레이스 크루 2인조/);
  await rows.nth(1).getByRole('button', { name: /기록 삭제/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=recent] [data-testid=game-row]').length === 1);
  await page.getByRole('button', { name: '전체 기록 지우기' }).click();
  await page.getByTestId('recent-empty').waitFor();

  // 내 리뷰 내역 → 삭제
  await page.getByRole('link', { name: '내 리뷰' }).click();
  const my = page.getByTestId('my-reviews');
  await my.waitFor();
  assert.match(await my.textContent(), /왕국의 수.*전략 좋아요/s);
  await my.getByRole('button', { name: '삭제' }).click();
  await page.getByTestId('reviews-empty').waitFor();

  // 새 비밀번호로 다시 로그인
  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  await page.goto(`${base}/mypage/profile`);
  await page.getByText('로그인이 필요해요').waitFor();
  await page.goto(`${base}/login?next=%2Fmypage%2Freviews`);
  await page.getByPlaceholder('아이디').fill('mypage_u');
  await page.getByPlaceholder('비밀번호').fill('changed123');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(/\/mypage\/reviews/);
  assert.deepEqual(errors, []);
  await page.close();
});
