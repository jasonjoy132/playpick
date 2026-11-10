// 배포용 데이터 갱신: `npm run refresh:grac` (로컬에서 돌리고 결과를 커밋)
//  배포(Vercel)는 디스크에 쓸 수 없고 게관위 전체 목록을 매번 받기엔 느려서, 미리 받아 server/data 에 git 파일로 둠
//  1) 게관위 전체 목록(약 3.3만 건) → server/data/grac-index.json   (--skip-grac 로 건너뜀, 기본은 전체 다시 받기)
//  2) .cache 의 IGDB 존재 확인·번역 캐시 → server/data/grac-igdb-check.json, translations.json (복사만, .cache 는 그대로)
//
//   npm run refresh:grac
//   npm run refresh:grac -- --incremental   지난번 이후 새로 등급분류된 것만 추가
//   npm run refresh:grac -- --skip-grac     캐시 복사만
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createGracIndex } from '../server/providers/gracIndex.js';
import { createGracProvider } from '../server/providers/gracProvider.js';

const args = process.argv.slice(2);
const config = getConfig();
const kb = (f) => `${Math.round(fs.statSync(f).size / 1024).toLocaleString()}KB`;

if (!args.includes('--skip-grac')) {
  const seed = config.grac.indexSeed;
  const index = createGracIndex({ grac: createGracProvider(config.grac), cacheFile: seed, seedFile: null, log: (m) => console.log(m) });
  const t0 = Date.now();
  console.log(`게관위 목록 받는 중 (${args.includes('--incremental') ? '추가분' : '전체'})…`);
  await index.refresh({ full: !args.includes('--incremental') });
  const snap = index.snapshot();
  if (snap.status !== 'ready') {
    console.log('게관위 목록을 받지 못했어요.', snap.error ?? '');
    process.exit(1);
  }
  console.log(`→ ${path.relative(config.root, seed)} ${kb(seed)} (${Math.round((Date.now() - t0) / 1000)}초)`);
}

// 캐시 → 시드 복사: 시드에 있던 값 위에 캐시 값을 덮음(번역), 확인 시각이 더 최근인 값(IGDB 존재 확인)
const merge = (seedFile, cacheFile, pick) => {
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return {};
    }
  };
  const out = read(seedFile);
  for (const [k, v] of Object.entries(read(cacheFile))) out[k] = k in out ? pick(out[k], v) : v;
  fs.writeFileSync(seedFile, JSON.stringify(out));
  console.log(`→ ${path.relative(config.root, seedFile)} ${kb(seedFile)} (${Object.keys(out).length.toLocaleString()}개)`);
};
merge(config.grac.igdbCheckSeed, config.grac.igdbCheckFile, (a, b) => ((b?.at ?? 0) >= (a?.at ?? 0) ? b : a));
merge(config.deepl.seedFile, config.deepl.cacheFile, (_a, b) => b);
console.log('끝. git 으로 커밋하면 배포에 반영돼요.');
