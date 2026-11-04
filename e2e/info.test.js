// E2E: 바닥글 링크 → 이용약관·개인정보처리방침·데이터 출처 페이지, 회원가입 동의 안내
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

test('바닥글에서 약관·개인정보처리방침·데이터 출처 페이지로 이동', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const footer = page.getByRole('navigation', { name: '사이트 정보' });

  for (const [label, path, testId, heading] of [
    ['이용약관', '/terms', 'terms-page', '이용약관'],
    ['개인정보처리방침', '/privacy', 'privacy-page', '개인정보처리방침'],
    ['데이터 출처', '/sources', 'sources-page', '데이터 출처'],
  ]) {
    await footer.getByRole('link', { name: label }).click();
    await page.waitForURL(`${base}${path}`);
    const doc = page.getByTestId(testId);
    await doc.waitFor();
    assert.equal(await doc.getByRole('heading', { level: 1 }).textContent(), heading);
  }

  const sources = page.getByTestId('sources-page');
  for (const name of ['IGDB', 'RAWG', 'DeepL', 'Google Gemini']) assert.ok((await sources.getByRole('link', { name }).count()) > 0, `${name} 출처 표시`);
  assert.ok((await sources.getByText('AI 추정', { exact: true }).count()) > 0);

  // 새로 고침(직접 주소 입력)해도 열림
  await page.goto(`${base}/privacy`);
  await page.getByTestId('privacy-page').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('회원가입 화면에 약관·개인정보처리방침 동의 안내와 링크', async () => {
  const page = await browser.newPage({ locale: 'ko-KR' });
  await page.goto(`${base}/signup`);
  const note = page.getByTestId('signup-consent');
  await note.waitFor();
  await note.getByRole('link', { name: '개인정보처리방침' }).click();
  await page.getByTestId('privacy-page').waitFor();
  await page.close();
});
