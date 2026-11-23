// 유료·무료: 스토어 근거(Steam·App Store) → 미리 저장한 AI → 정보 없음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';
import { appStoreFree, appStoreId, buildPricePrompt, createPricing, createSteamPrice, parsePriceAnswer, priceKey, steamFree } from '../server/services/pricing.js';

const igdb = (id, extra = {}) => ({ id, source: 'IGDB', title: id, stores: [], ...extra });

test('Steam 응답: is_free 그대로, 출시 전 유료는 모름, 실패는 모름', () => {
  assert.equal(steamFree({ 730: { success: true, data: { is_free: true } } }, '730'), true);
  assert.equal(steamFree({ 1: { success: true, data: { is_free: false, release_date: { coming_soon: false } } } }, '1'), false);
  assert.equal(steamFree({ 1: { success: true, data: { is_free: false, release_date: { coming_soon: true } } } }, '1'), null);
  assert.equal(steamFree({ 1: { success: false } }, '1'), null);
  assert.equal(appStoreFree({ price: 0 }), true);
  assert.equal(appStoreFree({ price: 4400 }), false);
  assert.equal(appStoreFree(undefined), null);
  assert.equal(appStoreId('https://apps.apple.com/kr/app/x/id1517783697?uo=4'), '1517783697');
});

test('AI 답: 모른다고 하면 null(정보 없음), 질문에 게임 이름', () => {
  const m = parsePriceAnswer([{ i: 0, known: true, free: true }, { i: 1, known: false, free: false }, { i: 2, known: true, free: 'yes' }]);
  assert.deepEqual([...m], [[0, true], [1, null], [2, null]]);
  assert.match(buildPricePrompt([{ title: 'PUBG', originalTitle: 'PUBG: Battlegrounds' }]), /PUBG: Battlegrounds/);
});

test('파일 값: 모름·이상한 출처는 안 붙임, 데모·제보 게임은 키 없음, 이미 있는 값은 그대로', () => {
  const p = createPricing(null, { entries: { 'igdb-1': { free: true, source: 'steam' }, 'igdb-2': { free: null, source: 'ai' }, 'igdb-3': { free: false, source: 'guess' }, 'igdb-4': { free: false, source: 'ai' } } });
  const out = p.applyAll([igdb('igdb-1'), igdb('igdb-2'), igdb('igdb-3'), igdb('igdb-4'), igdb('igdb-1', { price: { free: false, source: 'steam' } })]);
  assert.deepEqual(out.map((g) => g.price ?? null), [{ free: true, source: 'steam' }, null, null, { free: false, source: 'ai' }, { free: false, source: 'steam' }]);
  assert.equal(priceKey({ id: 'demo-1', isDemo: true, source: 'IGDB' }), null);
  assert.equal(priceKey({ id: 'user-1', source: '사용자 제보' }), null);
});

test('상세 Steam 확인: 스토어 근거가 없으면 Steam 값으로 덮고, 늦으면 그대로', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.match(url, /appids=570&cc=kr/);
    return { ok: true, json: async () => ({ 570: { success: true, data: { is_free: true } } }) };
  };
  const sp = createSteamPrice({ fetchImpl });
  const g = igdb('igdb-5', { stores: [{ name: 'Steam', url: 'https://store.steampowered.com/app/570/Dota_2/' }], price: { free: false, source: 'ai' } });
  assert.deepEqual((await sp.attach(g)).price, { free: true, source: 'steam' });
  await sp.attach(g);
  assert.equal(calls, 1, '하루 저장');
  const known = { ...g, price: { free: false, source: 'appstore' } };
  assert.equal(await sp.attach(known), known, '스토어 근거가 있으면 안 물음');
  const slow = createSteamPrice({ fetchImpl: () => new Promise(() => {}) });
  assert.equal((await slow.attach({ ...g, price: undefined }, { waitMs: 10 })).price, undefined);
});

test('API: 목록·상세에 price 가 붙음(저장 값), 없으면 없음', async () => {
  const pricing = { applyAll: (games) => games.map((g) => (g.id === 'demo-02' ? { ...g, price: { free: true, source: 'ai' } } : g)) };
  const server = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:' }, { pricing });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const d = await (await fetch(`${base}/api/games/demo-02`)).json();
    assert.deepEqual(d.game.price, { free: true, source: 'ai' });
    const other = await (await fetch(`${base}/api/games/demo-01`)).json();
    assert.equal(other.game.price, undefined);
  } finally {
    server.close();
  }
});
