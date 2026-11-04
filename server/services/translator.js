// 게임 소개 한국어 번역 (DeepL API)
// 문서: https://developers.deepl.com/docs/api-reference/translate
//   POST {https://api-free.deepl.com | https://api.deepl.com}/v2/translate
//   헤더 Authorization: DeepL-Auth-Key <키>, JSON { text: [..], target_lang }
//   응답 { translations: [{ text, detected_source_language }] } (입력 순서와 동일)
// - 키가 없거나 번역에 실패하면 원문을 그대로 돌려주고 translated=false 로 표시합니다(번역한 척하지 않음).
// - 같은 문장을 반복 번역하지 않도록 결과를 파일(.cache/translations.json)에 캐시합니다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HANGUL = /[가-힣]/;
const hash = (t) => crypto.createHash('sha1').update(t).digest('hex');

export function deeplUrlFor(key, override) {
  if (override) return override;
  // DeepL 무료 계정 키는 ':fx' 로 끝남 → 무료 엔드포인트
  return key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
}

export function createTranslator(cfg = {}, { fetchImpl = globalThis.fetch } = {}) {
  const configured = Boolean(cfg.apiKey);
  const url = configured ? deeplUrlFor(cfg.apiKey, cfg.apiUrl) : null;
  const cacheFile = cfg.cacheFile || null;
  let cache = {};
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      cache = {};
    }
  }
  const save = () => {
    if (!cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      /* 캐시 저장 실패는 무시 */
    }
  };

  /**
   * @param {(string|null)[]} texts
   * @returns {Promise<{ text: string|null, translated: boolean, error?: string }[]>}
   */
  async function translateMany(texts) {
    const out = texts.map((t) => {
      if (!t) return { text: t, translated: false };
      if (HANGUL.test(t)) return { text: t, translated: false, alreadyKorean: true };
      const c = cache[hash(t)];
      return c ? { text: c, translated: true } : null;
    });
    const pending = texts.map((t, i) => (out[i] ? null : i)).filter((i) => i != null);
    if (!pending.length) return out;
    if (!configured) {
      for (const i of pending) out[i] = { text: texts[i], translated: false, error: 'NOT_CONFIGURED' };
      return out;
    }
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pending.map((i) => texts[i]), target_lang: 'KO' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(res.status === 456 ? 'QUOTA_EXCEEDED' : `HTTP_${res.status}`);
      const body = await res.json();
      const tr = body?.translations;
      if (!Array.isArray(tr) || tr.length !== pending.length) throw new Error('INVALID_RESPONSE');
      pending.forEach((i, k) => {
        const text = tr[k]?.text;
        if (text) {
          cache[hash(texts[i])] = text;
          out[i] = { text, translated: true };
        } else {
          out[i] = { text: texts[i], translated: false, error: 'INVALID_RESPONSE' };
        }
      });
      save();
    } catch (e) {
      const code = e?.name === 'TimeoutError' ? 'TIMEOUT' : e?.message?.match(/^[A-Z_0-9]+$/) ? e.message : 'NETWORK';
      for (const i of pending) out[i] = { text: texts[i], translated: false, error: code };
    }
    return out;
  }

  /**
   * 게임 이름·검색어 번역 (한↔영, 검색을 언어와 상관없이 같게 하려고). 실패·미설정이면 null
   * @param {string[]} texts
   * @param {'EN'|'KO'} target
   */
  async function translateTitles(texts, target) {
    const key = (t) => `title:${target}:${hash(t)}`;
    const out = texts.map((t) => {
      if (!t) return null;
      const already = target === 'KO' ? HANGUL.test(t) : !HANGUL.test(t);
      if (already) return t;
      return cache[key(t)] ?? undefined;
    });
    const pending = [...new Set(texts.filter((t, i) => out[i] === undefined))];
    if (pending.length && configured) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `DeepL-Auth-Key ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pending, target_lang: target === 'EN' ? 'EN-US' : 'KO' }),
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          const tr = (await res.json())?.translations;
          if (Array.isArray(tr) && tr.length === pending.length) {
            pending.forEach((t, k) => tr[k]?.text && (cache[key(t)] = tr[k].text));
            save();
          }
        }
      } catch {
        /* 번역 실패: 원래 검색어만 사용 */
      }
    }
    return texts.map((t, i) => (out[i] === undefined ? (cache[key(t)] ?? null) : out[i]));
  }

  return { configured, translateMany, translateTitles, translate: async (t) => (await translateMany([t]))[0] };
}

/** 게임 목록의 summary 를 번역해 summaryKo / summaryTranslated 필드로 붙임 */
export async function withKoreanSummaries(translator, games) {
  const results = await translator.translateMany(games.map((g) => g.summary));
  return games.map((g, i) => ({
    ...g,
    summaryKo: results[i].translated || results[i].alreadyKorean ? results[i].text : null,
    summaryTranslated: Boolean(results[i].translated),
    translationError: results[i].error ?? null,
  }));
}
