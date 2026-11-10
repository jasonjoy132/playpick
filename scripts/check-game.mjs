// 게임 하나가 왜 목록에 보이는지/숨겨지는지 확인: `npm run check:game -- 버블파이터`
// IGDB 검색 결과와 게임위 목록에서 이름이 비슷한 게임을 찾아 출처·상태·AI 판단을 보여 줍니다(아무것도 바꾸지 않음).
import fs from 'node:fs';
import { getConfig } from '../server/config.js';
import { createIgdbProvider, normTitle } from '../server/providers/igdbProvider.js';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createGracProvider } from '../server/providers/gracProvider.js';
import { createPartySize, cacheKey, mayEnd } from '../server/services/partySize.js';

const q = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
if (!q) {
  console.log('사용법: npm run check:game -- <게임 이름>');
  process.exit(1);
}
const config = getConfig();
const ps = createPartySize({ ...config.gemini, live: false });
let raw = {};
try {
  raw = JSON.parse(fs.readFileSync(config.gemini.dataFile, 'utf8'));
} catch {
  /* 없음 */
}
const ai = (g) => {
  const e = raw[cacheKey(g)];
  if (!e) return 'AI 기록 없음';
  const parts = [];
  if ('status' in e) parts.push(`상태 ${e.status ?? '모름'}`);
  if ('ended' in e) parts.push(`서비스 종료 ${e.ended === true ? '예' : e.ended === false ? '아니오' : '모름'}`);
  if (e.endedModels) parts.push(`종료 확인 모델 ${e.endedModels.join(',')}`);
  if (e.statusModel) parts.push(`상태 확인 ${e.statusModel}`);
  if (e.statusEvidence) parts.push(`근거 ${e.statusEvidence}`);
  return parts.join(' · ') || '인원·시간만 있음';
};

const igdb = createIgdbProvider(config.igdb ?? {});
if (igdb.configured) {
  console.log(`\n■ IGDB 검색 '${q}'`);
  const found = await igdb.searchByTitle(q, 10);
  if (!found.length) console.log('  없음');
  for (const g of found) {
    const [a] = ps.applyCached([g]);
    const why = g.hidden ? `숨김(IGDB 상태 ${g.gameStatus})` : a.aiEnded ? '숨김(AI가 서비스 종료로 판단)' : '목록에 보임';
    console.log(`  - ${g.title} (igdb-${String(g.id).replace('igdb-', '')}, ${g.firstYear ?? '?'}) 모드 [${(g.gameModes ?? []).join(', ')}] · IGDB 상태 ${g.gameStatus ?? '없음'}`);
    console.log(`    → ${why} · 종료 확인 대상 ${mayEnd(g) ? '예' : '아니오(온라인 모드 정보 없음)'} · ${ai(g)}`);
  }
} else console.log('IGDB 설정이 없어 IGDB 검색은 건너뜀');

const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: config.grac.indexFile, seedFile: config.grac.indexSeed });
const snap = index.snapshot();
if (snap.status === 'ready') {
  let exists = {};
  try {
    exists = JSON.parse(fs.readFileSync(config.grac.igdbCheckFile, 'utf8'));
  } catch {
    /* 없음 */
  }
  const n = normTitle(q);
  const hits = snap.games.filter((g) => normTitle(g.title).includes(n)).slice(0, 15);
  console.log(`\n■ 게임위 목록 '${q}' (${hits.length}개)`);
  for (const g of hits) {
    const inIgdb = exists[g.title]?.exists;
    console.log(`  - ${g.title} | ${g.publisher ?? '-'} | ${g.platformsRaw ?? ''} | ${g.ratingDate ?? ''}`);
    console.log(`    → ${inIgdb ? 'IGDB에 있음 → 게임위 카드로는 안 나옴(IGDB 카드)' : 'IGDB에 없음 → 게임위 카드'} · ${ai(g)}`);
  }
} else console.log('\n게임위 목록 파일이 아직 없어요.');
