// E2E 성과 분석: 추천 목록 → 상세 → 구매처를 누르면 익명 기록이 쌓이고, 만족도는 한 번만 물음
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

const kinds = async () => (await server.db.prepare('SELECT kind, store, meta FROM events ORDER BY id').all()).map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
async function until(check) {
  for (let i = 0; i < 50; i++) {
    const rows = await kinds();
    if (check(rows)) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return kinds();
}

test('추천 목록 → 상세 → 구매처 기록, 만족도 버튼은 한 번 누르면 사라짐', async () => {
  const errors = [];
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/results?players=2&platforms=pc&genres=rpg`);
  await page.getByTestId('result-count').waitFor();

  // 만족도: 한 번 누르면 고마움 문구, 다시 와도 안 물음
  await page.getByTestId('feedback-up').click();
  assert.match(await page.getByTestId('rec-feedback').innerText(), /고마워요/);

  await page.getByTestId('section-full').getByTestId('game-card').filter({ hasText: '던전 동맹' }).getByRole('link').click();
  await page.waitForURL(/\/games\/demo-02\?/);
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.getByTestId('store-link').first().click()]);
  await popup.close();

  const rows = await until((r) => r.some((x) => x.kind === 'store_click'));
  const got = rows.map((x) => x.kind);
  for (const k of ['visit', 'results', 'feedback', 'detail', 'store_click']) assert.ok(got.includes(k), `${k} 기록 (${got.join(',')})`);
  assert.equal(rows.find((x) => x.kind === 'detail').meta.from, 'results', '추천 목록에서 들어옴');
  assert.equal(rows.find((x) => x.kind === 'results').meta.zero, false);

  // 뒤로 가기로 목록에 돌아오면 목록 기록을 다시 세지 않고, 만족도도 다시 안 물음
  await page.goBack();
  await page.getByTestId('result-count').waitFor();
  assert.equal(await page.getByTestId('rec-feedback').count(), 0);
  await page.waitForTimeout(300);
  assert.equal((await kinds()).filter((x) => x.kind === 'results').length, 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});
