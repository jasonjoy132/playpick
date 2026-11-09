// E2E: 다크 모드 — 기기 설정 따라가기, 헤더 버튼으로 바꾸고 새로고침해도 유지
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

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('처음에는 기기 설정(prefers-color-scheme)을 따름', async () => {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ locale: 'ko-KR', colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(base);
    assert.equal(await theme(page), scheme);
    await ctx.close();
  }
});

test('헤더 버튼으로 다크 모드 전환, 새로고침해도 유지, 다시 누르면 라이트', async () => {
  const ctx = await browser.newContext({ locale: 'ko-KR', colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const lightBg = await bg(page);

  const toggle = page.getByTestId('theme-toggle');
  assert.equal(await toggle.getAttribute('aria-label'), '다크 모드로 바꾸기');
  await toggle.click();
  assert.equal(await theme(page), 'dark');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction((before) => getComputedStyle(document.body).backgroundColor !== before, lightBg);

  await page.reload();
  assert.equal(await theme(page), 'dark', '새로고침해도 다크 유지');
  assert.equal(await page.getByTestId('theme-toggle').getAttribute('aria-label'), '라이트 모드로 바꾸기');

  await page.getByTestId('theme-toggle').click();
  assert.equal(await theme(page), 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'light');
  assert.deepEqual(errors, []);
  await ctx.close();
});
