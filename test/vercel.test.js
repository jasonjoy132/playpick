// 배포(Vercel) 진입점: api/index.js 가 기존 서버로 요청을 넘기고, vercel.json 이 API·사진 주소를 함수로 보냄
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

test('vercel.json: API·사진은 함수로, 나머지는 화면(index.html)', () => {
  const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const dest = (p) => v.rewrites.find((r) => new RegExp(`^${r.source.replace('(.*)', '.*')}$`).test(p))?.destination;
  assert.equal(dest('/api/health'), '/api/index');
  assert.equal(dest('/avatars/u1-0123456789abcdef.png'), '/api/index');
  assert.equal(dest('/submission-images/p1-0123456789abcdef.webp'), '/api/index');
  assert.equal(dest('/games/igdb-1'), '/index.html');
  assert.equal(v.outputDirectory, 'client/dist');
  // 화면(정적 파일)에도 보안 헤더: 다른 사이트가 iframe 으로 감싸지 못하게(클릭재킹) 등
  const h = Object.fromEntries(v.headers.find((x) => x.source === '/(.*)').headers.map((x) => [x.key, x.value]));
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.match(v.functions['api/index.js'].includeFiles, /server\/data/);
});

test('api/index.js: 요청을 서버로 넘기고 응답이 끝날 때까지 기다림', async () => {
  process.env.DB_FILE = ':memory:';
  const { default: handler } = await import('../api/index.js');
  const srv = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => srv.listen(0, r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal((await fetch(`${base}/avatars/u1-0123456789abcdef.png`)).status, 404);
  } finally {
    srv.close();
  }
});
