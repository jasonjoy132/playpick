// 로그인 없이 부르는 검색·상세는 DeepL 번역(유료)·IGDB를 부르므로 IP 하나가 쏟아붓지 못하게 제한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

let server, base;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('검색: 같은 IP 분당 40번까지, 넘으면 429', async () => {
  for (let i = 0; i < 40; i++) assert.equal((await fetch(`${base}/api/search?q=q${i}`)).status, 200, `${i}번째`);
  const r = await fetch(`${base}/api/search?q=more`);
  assert.equal(r.status, 429);
  assert.equal((await r.json()).error.code, 'RATE_LIMIT');
  // 잘못된 검색어는 제한 전에 400 (세지 않음)
  assert.equal((await fetch(`${base}/api/search?q=`)).status, 400);
});

test('상세: 같은 IP 분당 120번까지, 넘으면 429', async () => {
  const id = (await (await fetch(`${base}/api/browse/popular`)).json()).games[0].id;
  for (let i = 0; i < 120; i++) assert.equal((await fetch(`${base}/api/games/${encodeURIComponent(id)}`)).status, 200, `${i}번째`);
  assert.equal((await fetch(`${base}/api/games/${encodeURIComponent(id)}`)).status, 429);
});
