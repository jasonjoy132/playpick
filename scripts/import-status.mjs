// 외부 AI가 판단한 게임위 '모름' 게임 서비스 상태 반영: `npm run import:status -- <결과 파일...>`
//
//   npm run import:status -- server/data/status-review/result-part1.csv
//   npm run import:status -- server/data/status-review/result-*.csv --dry   (저장하지 않고 결과만 보기)
//   npm run import:status -- result.csv --force                            (이미 상태가 정해진 게임도 덮어쓰기)
//
// - 결과 파일: CSV(id,status[,evidence]) · JSON 배열([{id,status,evidence}]) · 마크다운 표 모두 됨
//   status 는 released/ended/upcoming/unknown (서비스 중/종료/출시 예정/모름 같은 한국어도 됨)
// - id → 게임 연결은 내보낸 목록(server/data/status-review/unknown-games.map.json)을 씀
// - id 가 igdb-<번호> 면 IGDB 게임 서비스 종료 확인 결과(npm run prefill:ended -- --export 로 내보낸 목록)
//   ended → 목록에서 숨김, released(서비스 중) → 보임, unknown → 그대로
// - 이미 '서비스 중/종료/출시 예정'으로 정해진 게임은 건너뜀(--force 면 덮어씀). 인원·플레이 시간은 그대로
// - ⚠ npm run prefill:players 가 돌아가는 중이면 끝난 뒤(또는 끈 뒤) 실행하세요. 동시에 쓰면 한쪽 결과가 덮일 수 있어요.
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { STATUS_VERSION } from '../server/services/partySize.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const files = args.filter((a) => !a.startsWith('--'));
const config = getConfig();
const dataFile = config.gemini.dataFile;
const mapFile = path.join(path.dirname(dataFile), 'status-review', 'unknown-games.map.json');

if (!files.length) {
  console.log('사용법: npm run import:status -- <결과 파일> [더 많은 파일] [--dry] [--force]');
  process.exit(1);
}
let idToKey = {};
try {
  idToKey = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
} catch {
  /* 게임위 목록을 내보낸 적 없음 (IGDB 결과만 반영할 때) */
}
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const STATUS = [
  [/^(released|alive|active|running|available|live|서비스\s*중|운영\s*중|서비스중|운영중|출시됨|판매\s*중)$/i, 'released'],
  [/^(ended|closed|shutdown|shut\s*down|discontinued|terminated|서비스\s*종료|종료|운영\s*종료|단종)$/i, 'ended'],
  [/^(upcoming|unreleased|not\s*released|announced|출시\s*예정|미출시|출시\s*전)$/i, 'upcoming'],
  [/^(unknown|null|none|unsure|n\/a|-|모름|알\s*수\s*없음|불명|확인\s*불가)?$/i, null],
];
const normStatus = (v) => {
  const s = String(v ?? '').trim().replace(/^["'`*]+|["'`*]+$/g, '');
  for (const [re, st] of STATUS) if (re.test(s)) return { ok: true, st };
  return { ok: false };
};

/** 결과 파일 → [{ id, status, evidence }] (CSV·JSON·마크다운 표·코드 블록 안 내용 모두) */
function parse(text) {
  const t = text.replace(/^﻿/, '').trim();
  const json = t.match(/\[[\s\S]*\]/);
  if (json) {
    try {
      const arr = JSON.parse(json[0]);
      if (Array.isArray(arr)) return arr.map((x) => ({ id: x.id, status: x.status, evidence: x.evidence ?? x.source ?? '' }));
    } catch {
      /* CSV로 */
    }
  }
  const out = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\||\|$/g, '');
    if (!line || /^```/.test(line) || /^[-:| ]+$/.test(line)) continue;
    const cells = line.includes('|') ? line.split('|').map((c) => c.trim()) : splitCsv(line);
    if (!/^(igdb-)?\d+$/i.test(cells[0] ?? '')) continue; // 머리글 등
    out.push({ id: /^igdb-/i.test(cells[0]) ? cells[0].toLowerCase() : Number(cells[0]), status: cells[1], evidence: cells.slice(2).join(',').trim() });
  }
  return out;
}
function splitCsv(line) {
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

const day = new Date().toISOString().slice(0, 10);
const count = { released: 0, ended: 0, upcoming: 0, unknown: 0, skipped: 0, badId: 0, badStatus: 0 };
const igdbCount = { ended: 0, alive: 0, unknown: 0, skipped: 0 };
const bad = [];
for (const f of files) {
  const rows = parse(fs.readFileSync(f, 'utf8'));
  console.log(`${f}: ${rows.length}줄`);
  for (const r of rows) {
    if (/^igdb-\d+$/.test(String(r.id))) {
      // IGDB 게임: 서비스 종료 여부만 (항목이 없으면 새로 만듦 — 인원·시간은 나중에 prefill:players 가 채움)
      const n = normStatus(String(r.status).replace(/^(true)$/i, 'ended').replace(/^(false)$/i, 'released'));
      if (!n.ok) {
        count.badStatus++;
        bad.push(`${r.id}: 알 수 없는 상태 "${r.status}"`);
        continue;
      }
      const key = String(r.id).slice(5);
      const e = data[key] ?? {};
      if (!FORCE && (e.endedModels ?? []).includes('external')) {
        igdbCount.skipped++;
        continue;
      }
      const ended = n.st === 'ended' ? true : n.st === 'released' ? false : null; // 출시 예정은 IGDB 자체 표시를 따름
      igdbCount[ended === true ? 'ended' : ended === false ? 'alive' : 'unknown']++;
      const evidence = String(r.evidence || '').slice(0, 300) || undefined;
      data[key] = {
        ...e,
        ended,
        endedV: 2,
        endedModels: [...new Set([...(e.endedModels ?? []), 'external'])],
        endedDate: day,
        ...(e.at ? {} : { at: Date.now() }),
        ...(evidence ? { endedEvidence: evidence } : {}),
      };
      continue;
    }
    const key = idToKey[String(r.id)];
    if (!key || !data[key]) {
      count.badId++;
      bad.push(`id ${r.id}: 목록에 없는 id`);
      continue;
    }
    const n = normStatus(r.status);
    if (!n.ok) {
      count.badStatus++;
      bad.push(`id ${r.id}: 알 수 없는 상태 "${r.status}"`);
      continue;
    }
    const e = data[key];
    if (!FORCE && e.status != null) {
      count.skipped++; // 이미 다른 방법(AI 재확인 등)으로 정해짐
      continue;
    }
    count[n.st ?? 'unknown']++;
    const evidence = String(r.evidence || '').slice(0, 300) || undefined;
    data[key] = {
      ...e,
      status: n.st,
      ended: n.st === 'ended' ? true : n.st ? false : null,
      statusV: STATUS_VERSION,
      statusModel: 'external',
      statusModels: [...new Set([...(e.statusModels ?? []), 'external'])],
      statusDate: day,
      ...(evidence ? { statusEvidence: evidence } : {}),
    };
  }
}
if (igdbCount.ended + igdbCount.alive + igdbCount.unknown + igdbCount.skipped) {
  console.log(`\nIGDB 게임: 서비스 종료 ${igdbCount.ended}개(목록에서 숨김) · 서비스 중 ${igdbCount.alive}개 · 모름 ${igdbCount.unknown}개(그대로 보임)${igdbCount.skipped ? ` · 이미 반영돼 건너뜀 ${igdbCount.skipped}개(--force 로 덮어쓰기)` : ''}`);
}
console.log(`\n게임위 게임: 서비스 중 ${count.released}개(목록에 보임) · 종료 ${count.ended}개(숨김) · 출시 예정 ${count.upcoming}개(출시 예정 목록에) · 모름 ${count.unknown}개`);
if (count.skipped) console.log(`이미 상태가 정해져 건너뜀 ${count.skipped}개 (--force 로 덮어쓰기)`);
if (bad.length) console.log(`⚠ 반영 못 한 줄 ${bad.length}개:\n  ${bad.slice(0, 20).join('\n  ')}${bad.length > 20 ? '\n  …' : ''}`);
if (DRY) {
  console.log('(--dry: 저장하지 않음)');
  process.exit(0);
}
const tmp = `${dataFile}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)))));
fs.renameSync(tmp, dataFile);
console.log(`✅ 저장: ${dataFile} (서버가 켜져 있으면 30초 안에 반영)`);
