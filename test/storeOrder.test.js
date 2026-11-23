// 상세 구매처 순서: 주요 공식 스토어 먼저, 회원 제보는 공식 뒤, 데모는 맨 뒤
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortStores, storeLabel } from '../client/src/lib/stores.js';

const s = (name, extra = {}) => ({ name, url: `https://x/${name}/${extra.n ?? ''}`, isDemo: false, ...extra });

test('Steam·PlayStation·Nintendo·Xbox가 Epic·GOG·모바일·itch.io보다 먼저', () => {
  const got = sortStores([s('itch.io'), s('GOG'), s('Google Play'), s('Epic Games Store'), s('Nintendo eShop'), s('Microsoft Store (Xbox)'), s('Steam'), s('PlayStation Store')]);
  assert.deepEqual(got.map((x) => x.name), ['Steam', 'PlayStation Store', 'Nintendo eShop', 'Microsoft Store (Xbox)', 'Epic Games Store', 'GOG', 'Google Play', 'itch.io']);
});

test('회원 제보는 공식 구매처 뒤, 데모는 맨 뒤, 모르는 이름은 끝 쪽', () => {
  const got = sortStores([s('GOG', { userReported: true }), s('데모', { isDemo: true }), s('기타'), s('Steam'), s('App Store', { appStore: true })]);
  assert.deepEqual(got.map((x) => x.name), ['Steam', 'App Store', '기타', 'GOG', '데모']);
});

test('같은 스토어가 여럿이면(같은 앱의 옛·새 주소, 회원 제보 중복) 앞의 하나만', () => {
  const got = sortStores([s('App Store', { n: 'itunes' }), s('App Store', { n: 'apps' }), s('Steam', { userReported: true }), s('Steam')]);
  assert.deepEqual(got.map((x) => `${x.name}:${x.n ?? ''}:${!!x.userReported}`), ['Steam::false', 'App Store:itunes:false']);
});

test('모바일 스토어만 다운로드 문구', () => {
  assert.equal(storeLabel(s('Steam')), 'Steam에서 보기');
  assert.equal(storeLabel(s('Google Play')), 'Google Play에서 다운로드');
  assert.equal(storeLabel({ name: '앱', appStore: true }), 'App Store에서 다운로드');
});
