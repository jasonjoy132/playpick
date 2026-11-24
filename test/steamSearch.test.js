// Steam 상점 검색 목록의 가격 → 무료·유료, IGDB 게임에 붙이기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteamSearch, pickByGame, steamSearchFree } from '../scripts/lib/steamSearch.mjs';

const row = (id, price) => `<a href="x" data-ds-appid="${id}"><span class="title">Game ${id}</span>${price}</a>`;
const FREE = '<div data-price-final="0"><div class="discount_final_price free">Free</div></div>';
const PAID = '<div data-price-final="850000"><div class="discount_final_price">₩ 8,500</div></div>';
const GIVEAWAY = '<div data-price-final="0"><div class="discount_original_price">₩ 9,000</div><div class="discount_final_price free">Free</div></div>';
const NONE = '<div data-price-final="0"></div>';

test('Steam 검색 가격: Free → 무료, 가격 → 유료, 100% 할인 → 유료, 가격 없음 → 모름', () => {
  assert.equal(steamSearchFree(FREE), true);
  assert.equal(steamSearchFree(PAID), false);
  assert.equal(steamSearchFree(GIVEAWAY), false);
  assert.equal(steamSearchFree(NONE), null);
  const rows = parseSteamSearch(row(1, FREE) + row(2, PAID) + '<a href="y" data-ds-bundleid="5">묶음</a>');
  assert.deepEqual(rows.map((r) => [r.id, r.free]), [['1', true], ['2', false]]);
});

test('IGDB 게임 하나에 Steam 앱이 여럿이면 리뷰 많은 앱 값, 모름은 안 씀', () => {
  const apps = { 10: { free: true, reviews: 5 }, 11: { free: false, reviews: 900 }, 12: { free: null, reviews: 1 } };
  const m = pickByGame([{ game: 7, uid: '10' }, { game: 7, uid: '11' }, { game: 8, uid: '12' }], apps);
  assert.deepEqual(m.get('igdb-7'), { free: false, appid: '11' });
  assert.equal(m.has('igdb-8'), false);
});
