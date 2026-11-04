// 검색 진단: npm run check:search -- 로스트아크
// IGDB·게임위 검색 결과와 최종 화면 결과를 비교해 왜 안 보이는지 확인 (search-check.log 저장)
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createCatalog, isRelevant } from '../server/services/catalog.js';
import { createIgdbProvider } from '../server/providers/igdbProvider.js';
import { createGracProvider } from '../server/providers/gracProvider.js';
import { createTranslator } from '../server/services/translator.js';

const q = process.argv.slice(2).join(' ').trim();
if (!q) {
  console.log('사용법: npm run check:search -- 검색어');
  process.exit(1);
}
const config = getConfig();
const lines = [];
const secrets = [config.igdb.clientId, config.igdb.clientSecret].filter((x) => x && x.length >= 4);
const log = (...a) => {
  const line = secrets.reduce((acc, s) => acc.split(s).join('***'), a.join(' '));
  lines.push(line);
  console.log(line);
};

log(`검색어: ${q} · ${new Date().toISOString()}`);
log('\n[IGDB 검색 결과]');
if (config.igdb.clientId && config.igdb.clientSecret) {
  try {
    const games = await createIgdbProvider(config.igdb).searchByTitle(q, 30);
    if (!games.length) log(' (없음)');
    for (const g of games) {
      log(` - ${g.title}${g.originalTitle ? ` / ${g.originalTitle}` : ''} [${g.id}] 출시 ${g.releaseDate ?? '-'} · 상태 ${g.gameStatus ?? '-'}${g.hidden ? ' · ⚠ 숨김(서비스 종료 등)' : ''} · 검색어와 이름 일치: ${isRelevant(g, q) ? 'O' : 'X'}`);
      log(`     별칭: ${(g.altNames || []).join(', ') || '-'}`);
    }
  } catch (e) {
    log(` ❌ ${e.message}`);
  }
} else log(' IGDB 설정 없음');

log('\n[게임물관리위원회 검색 결과]');
try {
  const games = await createGracProvider(config.grac).searchByTitle(q);
  if (!games.length) log(' (없음 — 등급거부·등급취소 항목은 제외됨)');
  for (const g of games) log(` - ${g.title} [${g.id}] ${g.rating ?? ''} · ${g.platformsRaw ?? '-'} · ${g.publisher ?? '-'}`);
} catch (e) {
  log(` ❌ ${e.message}`);
}

log('\n[플레이픽 검색 화면에 나오는 결과]');
try {
  const tr = createTranslator(config.deepl ?? {});
  const translate = tr.configured ? (texts, target) => tr.translateTitles(texts, target) : undefined;
  log(`한↔영 검색어 번역(DeepL): ${tr.configured ? '사용' : '키 없음 → 원래 검색어만'}`);
  const { games, warnings, translatedQuery } = await createCatalog({ ...config, dataSource: 'live' }).search(q, { translate });
  log(`번역한 검색어: ${translatedQuery ?? '(없음)'}`);
  if (warnings.length) log(' 경고: ' + warnings.join(' / '));
  if (!games.length) log(' (없음)');
  for (const g of games) log(` - ${g.title} [${g.id}] (${g.source})`);
} catch (e) {
  log(` ❌ ${e.message}`);
}
const out = path.join(config.root, 'search-check.log');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`\n결과 저장: ${out}`);
