// 화면 보안 정책(CSP): index.html 인라인 스크립트 해시가 맞는지, vercel.json 과 로컬 서버가 같은 값인지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PAGE_CSP, THEME_SCRIPT_HASH } from '../server/csp.js';

test('index.html 인라인 스크립트는 모두 CSP 해시로 허용됨', () => {
  const html = fs.readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, '인라인 스크립트는 다크 모드 하나');
  const hash = `'sha256-${crypto.createHash('sha256').update(scripts[0]).digest('base64')}'`;
  assert.equal(THEME_SCRIPT_HASH, hash, `인라인 스크립트가 바뀌었으면 server/csp.js·vercel.json 해시를 ${hash} 로`);
});

test('vercel.json 화면 CSP = server/csp.js (배포와 로컬이 같게)', () => {
  const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = v.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  assert.equal(csp, PAGE_CSP);
  assert.match(csp, /script-src 'self' 'sha256-/);
});
