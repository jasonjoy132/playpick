// 외부 AI 추천 인원 결과 반영 (npm run import:players)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResults, applyPlayersResults } from '../scripts/lib/playersResults.mjs';

test('결과 읽기: 머리글 있는 CSV(근거에 쉼표), 마크다운 표, JSON', () => {
  const csv = '﻿id,known,min,max,evidence\n1,true,1,4,"https://a.example, 4인 협동"\n2,false,,,\n';
  assert.deepEqual(parseResults(csv), [
    { id: 1, known: 'true', min: '1', max: '4', evidence: 'https://a.example, 4인 협동' },
    { id: 2, known: 'false', min: '', max: '', evidence: '' },
  ]);
  const md = '| id | known | min | max | evidence |\n|---|---|---|---|---|\n| 3 | true | 2 | 2 | 대전 |';
  assert.deepEqual(parseResults(md), [{ id: 3, known: 'true', min: '2', max: '2', evidence: '대전' }]);
  assert.deepEqual(parseResults('```json\n[{"id":4,"known":true,"min":1,"max":8}]\n```'), [{ id: 4, known: true, min: 1, max: 8, evidence: '' }]);
  // 머리글 없이 순서대로
  assert.deepEqual(parseResults('5,yes,1,2,근거'), [{ id: 5, known: 'yes', min: '1', max: '2', evidence: '근거' }]);
});

test('반영: 안다고 한 것만 인원, 상태·플레이 시간 그대로, 이미 숫자 있으면 건너뜀, 이상한 값·없는 id는 문제로', () => {
  const data = {
    'grac:가': { hours: 10, status: 'released', ended: false },
    'grac:나': { hours: null, status: 'released', ended: false, unknown: true, playersModel: 'gemini' },
    'grac:다': { status: 'released', min: 1, max: 2, playersModel: 'gemini' },
    'grac:라': { status: 'released' },
    'grac:마': { status: 'released' },
  };
  const map = { 1: 'grac:가', 2: 'grac:나', 3: 'grac:다', 4: 'grac:라', 5: 'grac:마' };
  const rows = parseResults('id,known,min,max,evidence\n1,true,1,4,https://x\n2,true,2,2,\n3,true,1,8,\n4,false,1,1,\n5,true,0,40,\n9,true,1,1,\n');
  const r = applyPlayersResults(data, map, rows, { day: '2026-11-05' });
  assert.deepEqual(r.count, { known: 2, unknown: 1, skipped: 1, badId: 1, badValue: 1, noEvidence: 1 });
  assert.deepEqual(data['grac:가'], { hours: 10, status: 'released', ended: false, min: 1, max: 4, playersModel: 'external', playersDate: '2026-11-05', playersEvidence: 'https://x' });
  assert.deepEqual(data['grac:나'], { hours: null, status: 'released', ended: false, min: 2, max: 2, playersModel: 'external', playersDate: '2026-11-05' }, 'Gemini가 몰랐던 게임은 외부 AI 답으로 채움');
  assert.equal(data['grac:다'].max, 2, '이미 숫자가 있으면 그대로');
  assert.deepEqual(data['grac:라'], { status: 'released', unknown: true, playersModel: 'external', playersDate: '2026-11-05' }, 'known:false 면 숫자를 줘도 모름');
  assert.deepEqual(data['grac:마'], { status: 'released' }, '이상한 값은 반영 안 함');

  // --force: 숫자가 있어도 안다고 한 답으로 덮어씀
  applyPlayersResults(data, map, parseResults('3,true,1,6,근거'), { force: true, day: '2026-11-05' });
  assert.equal(data['grac:다'].max, 6);
});

test('경고: 안다고 한 답이 거의 다 1~1이면 짐작했을 수 있다고 알림', () => {
  const data = {};
  const map = {};
  const lines = ['id,known,min,max,evidence'];
  for (let i = 1; i <= 10; i++) {
    data[`grac:${i}`] = { status: 'released' };
    map[i] = `grac:${i}`;
    lines.push(`${i},true,1,1,`);
  }
  const r = applyPlayersResults(structuredClone(data), map, parseResults(lines.join('\n')));
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /근거 없는 1~1명/);
  assert.match(r.warnings[1], /근거/);
  // 스토어 근거가 붙은 1~1(싱글 전용 확인)은 경고 안 함
  const withEvidence = lines.map((l, i) => (i ? `${l}https://store.steampowered.com/app/${i}/ Single-player only` : l));
  assert.deepEqual(applyPlayersResults(structuredClone(data), map, parseResults(withEvidence.join('\n'))).warnings, []);
});
