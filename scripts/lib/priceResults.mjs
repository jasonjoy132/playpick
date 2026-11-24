// 외부 AI가 답한 유료·무료 결과 읽기·반영 (prefill-price.mjs --import)
//  - 결과 형식: CSV(id,known,free,evidence) · 마크다운 표 · JSON 배열
//  - free: free/무료/true → 무료, paid/유료/false → 유료
//  - known 이 true 이고 free 가 올바를 때만 저장(출처 'ai', via 'external' → 화면 'AI 추정'), 아니면 '모름'
//  - 스토어 근거(Steam·App Store)가 있는 게임은 건드리지 않음. 이미 AI 값이 있으면 건너뜀(force 면 덮어씀)
import { splitCsv } from './playersResults.mjs';
import { STORE_SOURCES } from '../../server/services/pricing.js';

const COLS = ['id', 'known', 'free', 'evidence'];
const YES = /^(true|yes|y|1|o|예|네|확인|앎|안다)$/i;

export function parsePriceResults(text) {
  const t = String(text).replace(/^﻿/, '').trim();
  const json = t.match(/\[[\s\S]*\]/);
  if (json) {
    try {
      const arr = JSON.parse(json[0]);
      if (Array.isArray(arr) && arr.every((x) => x && typeof x === 'object')) return arr.map((x) => ({ id: Number(x.id), known: x.known, free: x.free, evidence: x.evidence ?? '' }));
    } catch {
      /* CSV로 */
    }
  }
  let cols = COLS;
  const out = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\||\|$/g, '');
    if (!line || /^```/.test(line) || /^[-:| ]+$/.test(line)) continue;
    const cells = line.includes('|') && !line.includes(',') ? line.split('|').map((c) => c.trim()) : splitCsv(line);
    if (/^id$/i.test(cells[0])) {
      cols = cells.map((c) => c.toLowerCase());
      continue;
    }
    if (!/^\d+$/.test(cells[0] ?? '')) continue;
    const o = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    if (cols.length < cells.length && cols.at(-1) === 'evidence') o.evidence = cells.slice(cols.length - 1).join(',');
    out.push({ id: Number(o.id), known: o.known, free: o.free, evidence: o.evidence ?? '' });
  }
  return out;
}

/** 'free'·'무료'·true → true, 'paid'·'유료'·false → false, 나머지 null */
export function freeValue(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (/^(free|무료|true|f2p|free-to-play)$/.test(s)) return true;
  if (/^(paid|유료|false|buy|구매)$/.test(s)) return false;
  return null;
}

/**
 * @param {{ entry: (k: string) => any, set: Function }} store createPricing 결과
 * @returns {{ count: { free: number, paid: number, unknown: number, skipped: number, badId: number, badValue: number } }}
 */
export function applyPriceResults(store, idToKey, rows, { force = false } = {}) {
  const count = { free: 0, paid: 0, unknown: 0, skipped: 0, badId: 0, badValue: 0 };
  for (const r of rows) {
    const key = idToKey[r.id];
    if (!key) {
      count.badId++;
      continue;
    }
    const old = store.entry(key);
    if (STORE_SOURCES.has(old?.source) || (!force && typeof old?.free === 'boolean')) {
      count.skipped++;
      continue;
    }
    const known = r.known === true || YES.test(String(r.known ?? '').trim());
    const free = freeValue(r.free);
    if (known && free === null) count.badValue++;
    const value = known ? free : null;
    store.set(key, value, 'ai', { via: 'external', ...(value !== null && r.evidence ? { evidence: String(r.evidence).slice(0, 200) } : {}) });
    if (value === null) count.unknown++;
    else value ? count.free++ : count.paid++;
  }
  return { count };
}
