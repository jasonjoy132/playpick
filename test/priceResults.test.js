// 외부 AI 유료·무료 결과 읽기·반영
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPriceResults, freeValue, parsePriceResults } from '../scripts/lib/priceResults.mjs';
import { createPricing } from '../server/services/pricing.js';

test('결과 읽기: CSV·마크다운 표, free/paid·무료/유료', () => {
  const rows = parsePriceResults('﻿id,known,free,evidence\n1,true,free,https://a, 인앱\n2,false,,\n| 3 | 예 | 유료 | x |');
  assert.deepEqual(rows.map((r) => [r.id, r.free]), [[1, 'free'], [2, ''], [3, '유료']]);
  assert.equal(rows[0].evidence, 'https://a,인앱', '근거 안의 쉼표도 이어 붙임');
  assert.equal(freeValue('무료'), true);
  assert.equal(freeValue('PAID'), false);
  assert.equal(freeValue('maybe'), null);
});

test('반영: known일 때만 값, 스토어 근거·이미 있는 AI 값은 그대로(force면 AI 값 덮음)', () => {
  const store = createPricing(null, { entries: { k3: { free: false, source: 'steam' }, k4: { free: true, source: 'ai' } } });
  const map = { 1: 'k1', 2: 'k2', 3: 'k3', 4: 'k4' };
  const rows = [
    { id: 1, known: 'true', free: 'free', evidence: 'x' },
    { id: 2, known: 'false', free: 'paid' },
    { id: 3, known: 'true', free: 'free' },
    { id: 4, known: 'true', free: 'paid' },
    { id: 9, known: 'true', free: 'free' },
  ];
  const { count } = applyPriceResults(store, map, rows);
  assert.deepEqual(count, { free: 1, paid: 0, unknown: 1, skipped: 2, badId: 1, badValue: 0 });
  assert.equal(store.entry('k1').via, 'external');
  assert.deepEqual(store.get({ source: 'IGDB', id: 'k1' }), { free: true, source: 'ai' }, "화면엔 'AI 추정'");
  assert.equal(store.entry('k2').free, null);
  assert.equal(store.entry('k3').source, 'steam');
  applyPriceResults(store, map, [rows[3]], { force: true });
  assert.equal(store.entry('k4').free, false);
});
