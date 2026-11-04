import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTranslator, deeplUrlFor, withKoreanSummaries } from '../server/services/translator.js';

const ok = (texts) => ({ ok: true, status: 200, json: async () => ({ translations: texts.map((t) => ({ text: t, detected_source_language: 'EN' })) }) });

test('엔드포인트: 무료 키(:fx)는 api-free', () => {
  assert.equal(deeplUrlFor('abc:fx'), 'https://api-free.deepl.com/v2/translate');
  assert.equal(deeplUrlFor('abc'), 'https://api.deepl.com/v2/translate');
  assert.equal(deeplUrlFor('abc', 'https://x/v2/translate'), 'https://x/v2/translate');
});

test('요청 형식, 한글·빈 값 건너뜀, 파일 캐시', async () => {
  const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pp-')), 'tr.json');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return ok(JSON.parse(init.body).text.map((t) => `[KO]${t}`));
  };
  const t = createTranslator({ apiKey: 'KEY:fx', cacheFile }, { fetchImpl });
  const r = await t.translateMany(['Hello', '안녕하세요', null, 'World']);
  assert.deepEqual(r.map((x) => x.text), ['[KO]Hello', '안녕하세요', null, '[KO]World']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'DeepL-Auth-Key KEY:fx');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { text: ['Hello', 'World'], target_lang: 'KO' });
  // 새 인스턴스도 파일 캐시 사용 → 추가 호출 없음
  const t2 = createTranslator({ apiKey: 'KEY:fx', cacheFile }, { fetchImpl });
  assert.equal((await t2.translate('Hello')).text, '[KO]Hello');
  assert.equal(calls.length, 1);
});

test('키 없음·오류·한도 초과 → 원문 유지(번역한 척 안 함), 키 비노출', async () => {
  const none = createTranslator({});
  assert.deepEqual(await none.translate('Hi'), { text: 'Hi', translated: false, error: 'NOT_CONFIGURED' });
  const quota = createTranslator({ apiKey: 'SECRET' }, { fetchImpl: async () => ({ ok: false, status: 456 }) });
  const r = await quota.translate('Hi');
  assert.equal(r.translated, false);
  assert.equal(r.error, 'QUOTA_EXCEEDED');
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  const net = createTranslator({ apiKey: 'k' }, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await net.translate('Hi')).error, 'NETWORK');
});

test('withKoreanSummaries: 번역 성공 시에만 summaryKo', async () => {
  const t = createTranslator({ apiKey: 'k' }, { fetchImpl: async (u, init) => ok(JSON.parse(init.body).text.map(() => '번역')) });
  const [a, b, c] = await withKoreanSummaries(t, [{ summary: 'Eng' }, { summary: '한국어 소개' }, { summary: null }]);
  assert.equal(a.summaryKo, '번역');
  assert.equal(a.summaryTranslated, true);
  assert.equal(b.summaryKo, '한국어 소개');
  assert.equal(b.summaryTranslated, false);
  assert.equal(c.summaryKo, null);
  const [d] = await withKoreanSummaries(createTranslator({}), [{ summary: 'Eng' }]);
  assert.equal(d.summaryKo, null);
});
