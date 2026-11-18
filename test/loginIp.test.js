// 보안: 한 IP에서 아이디를 바꿔 가며 대입(password spraying) → IP당 실패 30번이면 막힘, Origin: null 은 403
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

let server, base;
before(async () => {
  server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: {}, appStore: {} }, { mailer: { configured: false, devLog: false, send: async () => {} } });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick' };
const login = (loginId, password, headers = H) => fetch(`${base}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ loginId, password }) });

test('IP당 로그인 실패 30번이면 다른 아이디도 429, 그 전 정상 로그인은 실패 수에 안 셈', async () => {
  const signup = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: H, body: JSON.stringify({ loginId: 'spray_ok', password: 'secret123', nickname: '정상', email: 'ok@example.com' }) });
  assert.equal(signup.status, 201);
  for (let i = 0; i < 3; i++) assert.equal((await login('spray_ok', 'secret123')).status, 200, '성공은 IP 실패로 안 셈');
  // 아이디마다 4번 이하(아이디별 제한 5번 안쪽)로 바꿔 가며 30번 실패
  for (let i = 0; i < 30; i++) assert.equal((await login(`victim_${Math.floor(i / 4)}`, 'password1')).status, 401, `${i + 1}번째 실패`);
  assert.equal((await login('victim_99', 'password1')).status, 429, '새 아이디도 막힘');
  assert.equal((await login('spray_ok', 'secret123')).status, 429, '같은 IP는 10분 동안 막힘');
});

test("Origin: null 이나 이상한 Origin 은 500 이 아니라 403", async () => {
  assert.equal((await login('a', 'b', { ...H, Origin: 'null' })).status, 403);
  assert.equal((await login('a', 'b', { ...H, Origin: 'not a url' })).status, 403);
});
