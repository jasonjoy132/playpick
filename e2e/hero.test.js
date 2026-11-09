// E2E: 첫 화면 큰 안내에서 인원·플랫폼을 바로 골라 추천 목록으로
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

test('인원·플랫폼 고르고 추천 게임 찾기 → 추천 목록', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const hero = page.getByTestId('hero-finder');
  await hero.waitFor();
  await hero.getByLabel('2명').check();
  await hero.getByLabel('PC', { exact: true }).check();
  await hero.getByTestId('hero-go').click();
  await page.waitForURL(/\/results\?players=2&platforms=pc$/);
  await page.getByTestId('result-count').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('아무것도 안 고르면 조건 창이 열리고, 장르까지 고르기는 고른 값을 채워서 엶', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  await page.goto(base);
  const hero = page.getByTestId('hero-finder');
  await hero.getByTestId('hero-go').click();
  await page.getByTestId('finder').waitFor();
  await page.keyboard.press('Escape');

  await hero.getByLabel('3명').check();
  await hero.getByRole('button', { name: '장르까지 고르기' }).click();
  const finder = page.getByTestId('finder');
  await finder.waitFor();
  assert.equal(await finder.getByLabel('3명').isChecked(), true);
  await page.close();
});
