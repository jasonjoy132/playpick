// Gemini 속도 점검: `npm run check:gemini`
// 추천 인원 AI 추정이 왜 느린지 찾기 위해, 모델·'생각(thinking)' 설정별로 같은 질문을 보내
// 걸린 시간, 실제 모델, 생각 토큰 수, 답을 gemini-check.log 로 저장합니다. (키는 기록하지 않음)
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { GEMINI_API_BASE, buildPrompt } from '../server/services/partySize.js';

const config = getConfig();
const key = config.gemini?.apiKey;
const lines = [];
const log = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  lines.push(s);
  console.log(s);
};
const save = () => {
  const out = path.join(config.root, 'gemini-check.log');
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log(`\n결과 저장: ${out}`);
};

log(`Gemini 점검 · ${new Date().toISOString()} · Node ${process.version}`);
log(`GEMINI_API_KEY 설정=${Boolean(key)}, GEMINI_MODEL=${config.gemini?.model}`);
if (!key) {
  log('❌ .env 에 GEMINI_API_KEY 가 없습니다.');
  save();
  process.exit(0);
}

const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };

// 1) 연결 + 모델 목록
let flash = [];
{
  const t0 = Date.now();
  try {
    const r = await fetch(`${GEMINI_API_BASE}/models?pageSize=200`, { headers, signal: AbortSignal.timeout(20_000) });
    const body = await r.json().catch(() => null);
    log(`\n[1] 모델 목록: HTTP ${r.status}, ${Date.now() - t0}ms`);
    if (!r.ok) log('   오류:', body?.error?.message ?? '');
    flash = (body?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .filter((n) => /flash/.test(n));
    log(`   generateContent 가능한 Flash 모델: ${flash.join(', ') || '(없음)'}`);
  } catch (e) {
    log(`\n[1] 모델 목록 실패 (${Date.now() - t0}ms): ${e.name} ${e.cause?.code ?? ''} ${e.message}`);
  }
}

// 2) 같은 질문(실제 게임 3개)을 모델·생각 설정별로
const games = [
  { id: 'igdb-1', source: 'IGDB', title: 'PUBG: BATTLEGROUNDS', firstYear: 2017, gameModes: ['Multiplayer', 'Battle Royale'], players: { min: 1, max: 100 } },
  { id: 'igdb-2', source: 'IGDB', title: 'Apex Legends', firstYear: 2019, gameModes: ['Multiplayer', 'Battle Royale'], players: { min: 1, max: 60 } },
  { id: 'igdb-3', source: 'IGDB', title: 'World of Warcraft', firstYear: 2004, gameModes: ['Multiplayer', 'MMO'], players: null },
];
const prompt = buildPrompt(games);
const schema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { id: { type: 'INTEGER' }, min: { type: 'INTEGER', nullable: true }, max: { type: 'INTEGER', nullable: true } },
    required: ['id', 'min', 'max'],
  },
};
const thinkings = [
  ['thinkingLevel: minimal', { thinkingLevel: 'minimal' }],
  ['thinkingBudget: 0', { thinkingBudget: 0 }],
  ['설정 안 함(기본값)', null],
];
const models = [...new Set([config.gemini.model, ...flash.filter((n) => /lite/.test(n)).slice(0, 1), ...flash.filter((n) => !/lite|preview|exp|image|tts|audio|live/.test(n)).slice(0, 2)])];

log(`\n[2] 게임 3개 추천 인원 질문 — 모델: ${models.join(', ')}`);
for (const model of models) {
  for (const [label, thinkingConfig] of thinkings) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, ...(thinkingConfig ? { thinkingConfig } : {}), responseMimeType: 'application/json', responseSchema: schema },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await r.json().catch(() => null);
      const ms = Date.now() - t0;
      if (!r.ok) {
        log(` ✕ ${model} / ${label}: HTTP ${r.status} ${ms}ms — ${String(body?.error?.message ?? '').slice(0, 140)}`);
        continue;
      }
      const u = body.usageMetadata ?? {};
      const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
      log(` ✓ ${model} / ${label}: ${ms}ms · 실제 모델 ${body.modelVersion ?? '?'} · 생각 토큰 ${u.thoughtsTokenCount ?? 0} · 답 토큰 ${u.candidatesTokenCount ?? '?'} · 답 ${text.replace(/\s+/g, '')}`);
    } catch (e) {
      log(` ✕ ${model} / ${label}: ${Date.now() - t0}ms — ${e.name === 'TimeoutError' ? '90초 안에 응답 없음' : `${e.cause?.code ?? ''} ${e.message}`}`);
    }
  }
}
log('\n해석: ✓ 중 시간이 가장 짧고 답이 그럴듯한 조합을 쓰면 됩니다. (예: 배그 1~4, 에이펙스 1~3, WoW 1~5 근처)');
save();
