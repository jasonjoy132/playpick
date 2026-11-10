// E2E: 헤더 검색창을 누르면 최근 검색어 → 고르면 그 검색, 하나 지우기·전체 삭제, 중복은 맨 위로, 입력하면 거르기, Esc
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

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

const items = (page) => page.getByTestId('search-recent-item').allInnerTexts();
const clean = (list) => list.map((x) => x.replace(/[🕘×\n]/gu, '').trim());

test('최근 검색어: 보이기·고르기·지우기·거르기', async () => {
  const errors = [];
  const page = await (await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const box = page.getByLabel('게임명 검색');

  // 기록이 없으면 패널이 안 열림
  await box.click();
  assert.equal(await page.getByTestId('search-recent').count(), 0);

  for (const q of ['파티', '협동', '파티게임']) {
    await box.fill(q);
    await box.press('Enter');
    await page.waitForURL(new RegExp(`q=${encodeURIComponent(q)}`));
  }
  // 같은 검색어 다시 → 맨 위로, 중복 없음
  await box.fill('협동');
  await box.press('Enter');
  await page.waitForURL(/q=%ED%98%91%EB%8F%99/);

  await box.fill('');
  await box.click();
  await page.getByTestId('search-recent').waitFor();
  assert.deepEqual(clean(await items(page)), ['협동', '파티게임', '파티']);

  // 입력하면 거르기
  await box.fill('파티');
  assert.deepEqual(clean(await items(page)), ['파티게임'], '같은 글자는 빼고 포함된 것만');
  await box.press('Escape');
  await page.getByTestId('search-recent').waitFor({ state: 'detached' });

  // 고르면 그 검색으로
  await box.fill('');
  await box.click();
  await page.getByTestId('search-recent-item').filter({ hasText: '파티게임' }).getByRole('button', { name: '파티게임', exact: true }).click();
  await page.waitForURL(/q=%ED%8C%8C%ED%8B%B0%EA%B2%8C%EC%9E%84/);
  assert.equal(await box.inputValue(), '파티게임');

  // 키보드: ↓ 두 번 + Enter → 두 번째 검색어
  await page.mouse.move(5, 700); // 마우스가 목록 위에 있으면 그 항목이 먼저 골라짐
  await box.fill('');
  await box.focus();
  await page.getByTestId('search-recent').waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await box.press('Enter');
  await page.waitForURL(/q=%ED%98%91%EB%8F%99/);

  // 하나 지우기 → 전체 삭제 → 다시 눌러도 안 열림
  await box.fill('');
  await box.click();
  await page.getByTestId('search-recent-item').filter({ hasText: /^🕘\s*파티\s*×$/u }).getByTestId('search-recent-remove').click();
  assert.deepEqual(clean(await items(page)), ['협동', '파티게임']);
  await page.getByTestId('search-recent-clear').click();
  await page.getByTestId('search-recent').waitFor({ state: 'detached' });
  await page.getByRole('heading').first().click();
  await box.click();
  assert.equal(await page.getByTestId('search-recent').count(), 0);

  // 주소로 바로 들어와도 기록, 새로 고쳐도 남음
  await page.goto(`${base}/search?q=${encodeURIComponent('레이싱')}`);
  await page.reload();
  await box.fill('');
  await box.click();
  assert.deepEqual(clean(await items(page)), ['레이싱']);
  assert.deepEqual(errors, []);
});

test('모바일 폭: 최근 검색어 패널이 화면 안에', async () => {
  const page = await (await browser.newContext({ locale: 'ko-KR', viewport: { width: 375, height: 760 } })).newPage();
  await page.goto(`${base}/search?q=${encodeURIComponent('아주 긴 검색어를 넣어서 넘치는지 확인하는 검색어')}`);
  const box = page.getByLabel('게임명 검색');
  await box.fill('');
  await box.click();
  const panel = await page.getByTestId('search-recent').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 375, `패널이 화면 안 (${panel.x}, ${panel.width})`);
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('.nav') && e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => `${e.tagName}.${e.className}`).slice(0, 5));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `가로 스크롤 없음: ${wide}`);
});
