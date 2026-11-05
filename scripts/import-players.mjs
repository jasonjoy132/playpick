// 외부 AI가 답한 게관위 게임 추천 인원 반영: `npm run import:players -- <결과 파일...>`
//
//   npm run import:players -- server/data/players-review/result-part1.csv --dry   (저장하지 않고 결과만 보기 — 먼저 이걸로 확인)
//   npm run import:players -- server/data/players-review/result-part*.csv          (반영)
//   npm run import:players -- result.csv --force                                   (이미 인원 숫자가 있는 게임도 덮어쓰기)
//
// - 내보내기: npm run prefill:players -- --grac-players --export  → players-review/players-partN.csv + players.map.json
// - 질문: server/data/players-review/PROMPT-PLAYERS.md
// - 결과 파일: CSV(id,known,min,max,evidence) · 마크다운 표 · JSON 배열 모두 됨
// - known 이 true 이고 인원이 올바를 때만 저장(화면에는 'AI 추정'), 아니면 '모름'. 서비스 상태·플레이 시간은 그대로
// - ⚠ prefill:players·prefill:ended·import:status 가 돌아가는 중이면 끝난 뒤 실행하세요(같은 파일에 씀)
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { parseResults, applyPlayersResults } from './lib/playersResults.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const FORCE = args.includes('--force');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.log('사용법: npm run import:players -- <결과 파일> [더 많은 파일] [--dry] [--force]');
  process.exit(1);
}
const config = getConfig();
const dataFile = config.gemini.dataFile;
const mapFile = path.join(path.dirname(dataFile), 'players-review', 'players.map.json');
let idToKey;
try {
  idToKey = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
} catch {
  console.log(`❌ ${mapFile} 이 없어요. 먼저 npm run prefill:players -- --grac-players --export 로 내보낸 목록이 있어야 id를 게임에 연결할 수 있어요.`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const total = { known: 0, unknown: 0, skipped: 0, badId: 0, badValue: 0, noEvidence: 0 };
for (const f of files) {
  const rows = parseResults(fs.readFileSync(f, 'utf8'));
  const r = applyPlayersResults(data, idToKey, rows, { force: FORCE });
  for (const k of Object.keys(total)) total[k] += r.count[k];
  console.log(`\n■ ${f}: ${rows.length}줄 → 인원 ${r.count.known}개 · 모름 ${r.count.unknown}개 · 건너뜀 ${r.count.skipped}개${r.count.badId + r.count.badValue ? ` · 문제 ${r.count.badId + r.count.badValue}개` : ''}`);
  for (const k of r.known.slice(0, 12)) console.log(`   ${k.key.slice(5)} → ${k.min}~${k.max}명${k.evidence ? `  (${k.evidence.slice(0, 70)})` : ''}`);
  if (r.known.length > 12) console.log(`   … 외 ${r.known.length - 12}개`);
  for (const w of r.warnings) console.log(`   ⚠ ${w}`);
  for (const b of r.bad.slice(0, 8)) console.log(`   ✕ ${b}`);
  if (r.bad.length > 8) console.log(`   ✕ … 외 ${r.bad.length - 8}개`);
}
console.log(`\n합계: 인원 ${total.known}개 · 모름 ${total.unknown}개 · 건너뜀(이미 숫자 있음) ${total.skipped}개 · 문제 ${total.badId + total.badValue}개`);
if (DRY) {
  console.log('(--dry: 저장하지 않음. 괜찮으면 --dry 없이 다시 실행하세요)');
  process.exit(0);
}
const tmp = `${dataFile}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)))));
fs.renameSync(tmp, dataFile);
console.log(`✅ 저장함 → ${dataFile} (서버가 켜져 있으면 30초 안에 반영)`);
