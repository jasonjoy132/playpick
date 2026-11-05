// 외부 AI가 답한 게관위 게임 추천 인원 결과 읽기·검사·반영 (npm run import:players 에서 사용, 테스트 가능하게 분리)
import { sanitize } from '../../server/services/partySize.js';

/** CSV 한 줄 → 칸 (따옴표 안의 쉼표 처리) */
export function splitCsv(line) {
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') cells.push(cur.trim()), (cur = '');
    else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const COLS = ['id', 'known', 'min', 'max', 'evidence'];

/**
 * 결과 파일 → [{ id, known, min, max, evidence }]
 * CSV·마크다운 표·JSON 배열 모두 됨. 머리글이 있으면 이름으로, 없으면 id,known,min,max,evidence 순서로 읽음
 */
export function parseResults(text) {
  const t = text.replace(/^﻿/, '').trim();
  const json = t.match(/\[[\s\S]*\]/);
  if (json) {
    try {
      const arr = JSON.parse(json[0]);
      if (Array.isArray(arr) && arr.every((x) => x && typeof x === 'object')) return arr.map((x) => ({ id: x.id, known: x.known, min: x.min, max: x.max, evidence: x.evidence ?? x.source ?? '' }));
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
    out.push({ id: Number(o.id), known: o.known, min: o.min, max: o.max, evidence: o.evidence ?? '' });
  }
  return out;
}

const YES = /^(true|yes|y|1|o|예|네|확인|앎|안다)$/i;
const int = (v) => (v === '' || v == null ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

/**
 * 결과를 AI 데이터(party-size.json 내용)에 반영
 * - known 이 true 이고 1 ≤ min ≤ max ≤ 32 일 때만 인원 저장(출처 external), 아니면 '모름'
 * - 이미 인원 숫자가 있는 게임은 건너뜀(force 면 덮어씀). 이미 '모름'인 게임은 외부 AI가 아는 경우 채움
 * - 서비스 상태·플레이 시간 등 다른 값은 그대로
 * @returns {{ count: object, bad: string[], known: {key,min,max,evidence}[], warnings: string[] }}
 */
export function applyPlayersResults(data, idToKey, rows, { force = false, day = new Date().toISOString().slice(0, 10) } = {}) {
  const count = { known: 0, unknown: 0, skipped: 0, badId: 0, badValue: 0, noEvidence: 0 };
  const bad = [];
  const known = [];
  const seen = new Set();
  for (const r of rows) {
    const key = idToKey[String(r.id)];
    if (!key || !data[key] || seen.has(key)) {
      count.badId++;
      bad.push(`id ${r.id}: ${seen.has(key) ? '같은 id가 두 번' : '내보낸 목록에 없는 id'}`);
      continue;
    }
    seen.add(key);
    const e = data[key];
    const hasNumber = Number.isInteger(e.min);
    if (hasNumber && !force) {
      count.skipped++;
      continue;
    }
    const isKnown = r.known === true || YES.test(String(r.known ?? '').trim());
    const min = int(r.min);
    const max = int(r.max);
    if (isKnown) {
      const v = sanitize({ min, max }, null);
      if (!v) {
        count.badValue++;
        bad.push(`id ${r.id}: 인원 값이 올바르지 않음 (min ${r.min}, max ${r.max}) → 반영 안 함`);
        continue;
      }
      const evidence = String(r.evidence ?? '').trim().slice(0, 300);
      if (!evidence) count.noEvidence++;
      const { unknown, ...rest } = e;
      data[key] = { ...rest, min: v.min, max: v.max, playersModel: 'external', playersDate: day, ...(evidence ? { playersEvidence: evidence } : {}) };
      count.known++;
      known.push({ key, min: v.min, max: v.max, evidence });
    } else {
      if (hasNumber) {
        count.skipped++; // force 라도 '모름'으로 숫자를 지우지는 않음
        continue;
      }
      const { min: _a, max: _b, ...rest } = e;
      data[key] = { ...rest, unknown: true, playersModel: 'external', playersDate: day };
      count.unknown++;
    }
  }
  const warnings = [];
  const ones = known.filter((k) => k.min === 1 && k.max === 1).length;
  if (known.length >= 10 && ones / known.length >= 0.8) {
    warnings.push(`안다고 한 ${known.length}개 중 ${ones}개(${Math.round((ones / known.length) * 100)}%)가 1~1명이에요. 장르만 보고 짐작했을 수 있으니 근거를 확인해 보세요.`);
  }
  if (known.length && count.noEvidence / known.length > 0.5) warnings.push(`안다고 한 ${known.length}개 중 ${count.noEvidence}개는 근거(evidence)가 비어 있어요.`);
  return { count, bad, known, warnings };
}
