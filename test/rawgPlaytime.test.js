import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRawgPlaytime } from '../server/services/rawgPlaytime.js';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

test('파일 저장·읽기: 찾은 게임만 값, 못 찾은 게임은 null이지만 확인한 것으로 기록', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-rawg-'));
  const file = path.join(dir, 'rawg-playtime.json');
  try {
    const a = createRawgPlaytime(file, { now: () => Date.parse('2026-11-05T00:00:00Z') });
    a.set('igdb-1', { hours: 12, url: 'https://rawg.io/games/a', name: 'A' });
    a.set('igdb-2', null, 'NAME');
    a.save();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved['igdb-1'], { hours: 12, url: 'https://rawg.io/games/a', name: 'A', date: '2026-11-05' });
    assert.deepEqual(saved['igdb-2'], { hours: null, reason: 'NAME', date: '2026-11-05' });

    const b = createRawgPlaytime(file);
    assert.equal(b.size, 2);
    assert.deepEqual(b.get('igdb-1'), { hours: 12, url: 'https://rawg.io/games/a', name: 'A' });
    assert.equal(b.get('igdb-2'), null);
    assert.equal(b.get('igdb-3'), null);
    assert.equal(b.has('igdb-2'), true);
    assert.equal(b.isMiss('igdb-2'), true);
    assert.equal(b.isMiss('igdb-1'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('파일이 없으면 빈 상태 (오류 없음)', () => {
  const s = createRawgPlaytime(path.join(os.tmpdir(), 'pp-no-such-dir', 'none.json'));
  assert.equal(s.size, 0);
  assert.equal(s.get('igdb-1'), null);
});

test('서버가 켜진 동안 파일이 바뀌면 30초 뒤 다시 읽음', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-rawg-'));
  const file = path.join(dir, 'rawg-playtime.json');
  let t = 0;
  try {
    fs.writeFileSync(file, JSON.stringify({}));
    const s = createRawgPlaytime(file, { now: () => t });
    assert.equal(s.get('igdb-9'), null);
    fs.writeFileSync(file, JSON.stringify({ 'igdb-9': { hours: 3, url: 'https://rawg.io/games/n', name: 'N' } }));
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000)); // mtime 확실히 바뀌게
    t = 10_000;
    assert.equal(s.get('igdb-9'), null, '30초 전에는 그대로');
    t = 31_000;
    assert.equal(s.get('igdb-9').hours, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('상세 API: RAWG를 실시간으로 부르지 않고 파일 값만 사용', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    throw new Error('외부 호출 없음');
  };
  const rawgPlaytime = createRawgPlaytime(null, { entries: { 'demo-01': { hours: 9, url: 'https://rawg.io/games/x', name: 'X' } } });
  const s = createApp({ ...getConfig(), dataSource: 'demo', dbFile: ':memory:', rawg: { apiKey: 'r' } }, { fetchImpl, rawgPlaytime });
  await new Promise((r) => s.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/games/demo-01`);
    assert.equal(r.status, 200);
    const { game } = await r.json();
    assert.equal(game.playtime, null, '데모 게임은 플레이 시간 표시 안 함');
    assert.ok(!calls.some((u) => u.includes('rawg.io')), 'RAWG 호출 없음');
  } finally {
    s.close();
  }
});
