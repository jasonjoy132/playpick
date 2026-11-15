// DB 기반 호출 제한: 서버리스 인스턴스가 여러 개여도(= 제한기 객체가 달라도) 같은 DB면 횟수를 함께 셈
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createDbRateLimiter } from '../server/community/rateLimit.js';

test('DB 호출 제한: 인스턴스끼리 횟수 공유, 시간이 지나면 풀림, reset', async () => {
  const db = openDb(':memory:');
  let t = 1_000_000;
  const now = () => t;
  const a = createDbRateLimiter(db, { name: 'login', limit: 3, windowMs: 60_000, now });
  const b = createDbRateLimiter(db, { name: 'login', limit: 3, windowMs: 60_000, now }); // 다른 인스턴스
  const other = createDbRateLimiter(db, { name: 'mail', limit: 3, windowMs: 60_000, now });
  assert.equal(await a.hit('ip1'), true);
  assert.equal(await b.hit('ip1'), true);
  assert.equal(await a.hit('ip1'), true);
  assert.equal(await b.hit('ip1'), false, '네 번째는 다른 인스턴스에서도 막힘');
  assert.equal(await a.hit('ip2'), true, '다른 키는 따로');
  assert.equal(await other.hit('ip1'), true, '다른 이름은 따로');
  t += 61_000;
  assert.equal(await a.hit('ip1'), true, '시간이 지나면 풀림');
  await a.hit('ip1');
  await a.hit('ip1');
  assert.equal(await a.hit('ip1'), false);
  await b.reset('ip1');
  assert.equal(await a.hit('ip1'), true, 'reset 하면 처음부터');
  db.close();
});
