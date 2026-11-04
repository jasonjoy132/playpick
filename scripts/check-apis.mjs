// 실제 API 점검 스크립트: `npm run check:apis`
// 게임물관리위원회 API와 IGDB를 실제로 호출해 응답 형식·값을 확인하고 api-check.log 로 저장합니다.
// 비밀값(Client ID/Secret, 토큰)은 로그에 남기지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { GRAC_DEFAULT_URL, parseGracXml } from '../server/providers/gracProvider.js';
import { createIgdbProvider, IGDB_GENRE_NAMES, IGDB_PLATFORM_NAMES, IGDB_TOKEN_URL } from '../server/providers/igdbProvider.js';
import { createCatalog } from '../server/services/catalog.js';
import { recommend } from '../server/services/recommend.js';
import { createTranslator } from '../server/services/translator.js';
import { createRawgProvider } from '../server/providers/rawgProvider.js';
import { createAppStoreProvider, matchApp } from '../server/providers/appStoreProvider.js';
import { createGracProvider } from '../server/providers/gracProvider.js';

const config = getConfig();
const secrets = [config.igdb.clientId, config.igdb.clientSecret, config.deepl.apiKey, config.rawg.apiKey].filter((s) => s && s.length >= 4);
const lines = [];
const redact = (s) => secrets.reduce((acc, sec) => acc.split(sec).join('***'), String(s));
const log = (...a) => {
  const line = redact(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2))).join(' '));
  lines.push(line);
  console.log(line);
};
const section = (t) => log(`\n==================== ${t} ====================`);

// fetch 래퍼: 토큰도 로그에서 가리기
const realFetch = globalThis.fetch;
const fetchImpl = async (url, init) => {
  const res = await realFetch(url, init);
  if (String(url) === IGDB_TOKEN_URL) {
    const clone = res.clone();
    clone.json().then((b) => b?.access_token && secrets.push(b.access_token)).catch(() => {});
  }
  return res;
};

log(`PlayPick API 점검 · ${new Date().toISOString()} · Node ${process.version}`);
log(`DATA_SOURCE=${config.dataSource}, IGDB_CLIENT_ID 설정=${Boolean(config.igdb.clientId)}, IGDB_CLIENT_SECRET 설정=${Boolean(config.igdb.clientSecret)}`);

// ── 1. 게임물관리위원회 ──
section('1. 게임물관리위원회 API');
try {
  const url = new URL(config.grac.url || GRAC_DEFAULT_URL);
  url.searchParams.set('display', '100');
  url.searchParams.set('pageno', '1');
  log(`요청: ${url}`);
  const t0 = Date.now();
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.text();
  log(`응답: HTTP ${res.status}, content-type=${res.headers.get('content-type')}, ${body.length}자, ${Date.now() - t0}ms`);
  log('원문 앞부분:\n' + body.slice(0, 1200));
  try {
    const { total, games } = parseGracXml(body);
    log(`파싱 성공: tcount=${total}, 국내 이용 가능(등급거부·취소 제외) ${games.length}건`);
    const count = (key) => {
      const m = new Map();
      for (const g of games) m.set(g[key] ?? '(없음)', (m.get(g[key] ?? '(없음)') || 0) + 1);
      return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
    };
    log('genre 원문 값 분포:', count('genresRaw'));
    log('platform 원문 값 분포:', count('platformsRaw'));
    const unmapped = games.filter((g) => g.genresRaw && !g.genres).map((g) => g.genresRaw);
    log(`장르 매핑 안 된 값: ${[...new Set(unmapped)].join(', ') || '없음'}`);
    log('샘플 3건:', games.slice(0, 3).map(({ title, rating, genresRaw, platformsRaw, ratingDate }) => ({ title, rating, genresRaw, platformsRaw, ratingDate })));
  } catch (e) {
    log(`❌ 파싱 실패: [${e.code}] ${e.message}`);
  }
} catch (e) {
  log(`❌ 호출 실패: ${e.name}: ${e.message}${e.cause ? ` (cause: ${e.cause.code || e.cause.message})` : ''}`);
}

// ── 2. IGDB ──
section('2. IGDB API');
if (!config.igdb.clientId || !config.igdb.clientSecret) {
  log('⏭ .env 에 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET 이 없어 건너뜀');
} else {
  const igdb = createIgdbProvider(config.igdb, { fetchImpl });
  try {
    const genres = await igdb.query('genres', 'fields id,name; limit 500;');
    log(`✅ 인증·호출 성공. IGDB 장르 ${genres.length}개: ${genres.map((g) => g.name).join(' | ')}`);
    const names = new Set(genres.map((g) => g.name));
    const missing = Object.values(IGDB_GENRE_NAMES).flat().filter((n) => !names.has(n));
    log(`매핑표에 있지만 IGDB에 없는 장르 이름: ${missing.join(', ') || '없음'}`);
    const maps = await igdb.getIdMaps();
    log('플레이픽 조건 → IGDB id:', maps);
    const missingP = Object.entries(IGDB_PLATFORM_NAMES).filter(([v]) => !maps.platforms[v].length).map(([v]) => v);
    log(`IGDB id를 못 찾은 플랫폼: ${missingP.join(', ') || '없음'}`);

    const raw = await igdb.query('games', 'search "Stardew Valley"; fields name,game_modes.name,multiplayer_modes.*,websites.url,websites.type.type,cover.url,game_localizations.name,game_localizations.region.name,age_ratings.organization.name,age_ratings.rating_category.rating; limit 1;');
    log('원문 샘플(Stardew Valley 검색):', raw[0] ?? '(결과 없음)');

    const st = await igdb.query('games', 'fields game_status.status; where version_parent = null & total_rating_count > 0 & game_status != null; sort total_rating_count desc; limit 500;');
    const dist = {};
    for (const r of st) dist[r.game_status?.status ?? '(없음)'] = (dist[r.game_status?.status ?? '(없음)'] || 0) + 1;
    log('인기 게임 중 game_status 값 분포(상태가 있는 것만, 최대 500):', dist);

    const sample = await igdb.searchByCriteria({ players: 2, platforms: ['pc'], genres: ['puzzle'] }, 10);
    log(`조건 검색(PC·퍼즐) ${sample.length}건:`);
    for (const g of sample) {
      log(` - ${g.title}${g.originalTitle ? ` (${g.originalTitle})` : ''} | 인원 ${g.players ? `${g.players.min}~${g.players.max}` : '정보 없음'} | 구매처 ${g.stores.map((s) => s.name).join(', ') || '없음'} | 표지 ${g.imageUrl ? 'O' : 'X'} | 글로벌 평점 ${g.globalRating ? `${g.globalRating.avg}/5 (${g.globalRating.count}개)` : '없음'}`);
    }
  } catch (e) {
    log(`❌ IGDB 실패: [${e.code ?? e.name}] ${e.message}`);
  }
}

// ── 3. 전체 흐름 (live 카탈로그 + 추천) ──
section('3. 추천 흐름 (live)');
try {
  const catalog = createCatalog({ ...config, dataSource: 'live' }, { fetchImpl });
  const criteria = { players: 2, platforms: ['pc'], genres: ['puzzle'] };
  const { games, warnings } = await catalog.listGames(criteria);
  const { fullMatches, partialMatches } = recommend(games, criteria);
  log(`출처: ${catalog.meta.sources.join(', ')} | 전체 ${games.length}건 → 모든 조건 일치 ${fullMatches.length}, 일부 일치 ${partialMatches.length}`);
  if (warnings.length) log('경고:', warnings);
  for (const r of fullMatches.slice(0, 5)) log(` ✓ ${r.game.title} [${r.game.source}${r.game.ratingSource === '게임물관리위원회' ? '+게임위 등급' : ''}]`);
  const igdbCount = games.filter((g) => g.source === 'IGDB').length;
  log(`IGDB 게임 ${igdbCount}건 중 게임위 등급으로 보완: ${games.filter((g) => g.source === 'IGDB' && g.ratingSource === '게임물관리위원회').length}건, IGDB 자체 GRAC 등급: ${games.filter((g) => g.ratingSource === 'IGDB(GRAC 등급)').length}건`);
  log(`IGDB에 없어 게임위에서 추가된 게임: ${games.filter((g) => g.source === '게임물관리위원회').length}건`);
} catch (e) {
  log(`❌ 추천 흐름 실패: [${e.code ?? e.name}] ${e.message}`);
}

// ── 3-1. 전체 검색 (IGDB 쪽 필터 + 페이지) ──
section('3-1. 나만의 게임 찾기: IGDB 전체 검색');
try {
  const catalog = createCatalog({ ...config, dataSource: 'live' }, { fetchImpl });
  for (const criteria of [
    { players: 1, platforms: ['pc'], genres: ['rpg'] },
    { players: 4, platforms: ['pc'], genres: ['action'] },
    { players: 5, platforms: [], genres: ['shooting'] },
  ]) {
    const r = await catalog.findMatches(criteria, { offset: 0, limit: 24 });
    if (!r) { log('IGDB 미설정 → 전체 검색 안 함'); break; }
    if (r.failed) { log(`❌ ${JSON.stringify(criteria)} 실패: [${r.failed.code ?? r.failed.name}] ${r.failed.message}`); continue; }
    const { fullMatches } = recommend(r.games, criteria);
    log(`${JSON.stringify(criteria)} → IGDB 전체 ${r.total}건, 1페이지 ${r.games.length}건 중 로컬 판정 완전 일치 ${fullMatches.length}건, 다음 페이지 ${r.hasMore ? '있음' : '없음'}`);
    for (const g of r.games.slice(0, 3)) log(`   · ${g.title} | 인원 ${g.players ? `${g.players.min}~${g.players.max}` : '정보 없음'}`);
  }
} catch (e) {
  log(`❌ 전체 검색 실패: [${e.code ?? e.name}] ${e.message}`);
}

// ── 4. IGDB 게임의 국내 등급 보완 (게임위 제목 검색) ──
section('4. IGDB 게임 → 게임위 등급 찾기 (상세 페이지 동작)');
if (config.igdb.clientId && config.igdb.clientSecret) {
  try {
    const catalog = createCatalog({ ...config, dataSource: 'live' }, { fetchImpl });
    const { games } = await catalog.listGames({ players: null, platforms: ['pc'], genres: ['puzzle'] });
    const targets = games.filter((g) => g.source === 'IGDB').slice(0, 8);
    let found = 0;
    for (const g of targets) {
      const d = await catalog.getGame(g.id);
      if (d?.ratingNo) found++;
      log(` - ${g.title}${g.originalTitle ? ` (${g.originalTitle})` : ''} → ${d?.ratingNo ? `${d.rating} [${d.ratingNo}]` : d?.warnings ? `조회 실패: ${d.warnings.join(' ')}` : '게임위에서 같은 제목 못 찾음'}`);
    }
    log(`${targets.length}건 중 ${found}건 국내 등급 확인`);
  } catch (e) {
    log(`❌ 실패: [${e.code ?? e.name}] ${e.message}`);
  }
} else {
  log('⏭ IGDB 설정 없음');
}

// ── 5. 첫 화면 이미지 / DeepL 번역 ──
section('5. 첫 화면 이미지 · DeepL 번역');
if (config.igdb.clientId && config.igdb.clientSecret) {
  try {
    const igdb = createIgdbProvider(config.igdb, { fetchImpl });
    const games = await igdb.featured(5);
    for (const g of games) {
      const st = async (u) => (u ? (await fetchImpl(u, { method: 'HEAD' })).status : '없음');
      log(` - ${g.title}: 표지 ${await st(g.imageUrl)}, 배너 ${await st(g.bannerUrl)}`);
    }
  } catch (e) {
    log(`❌ 이미지 확인 실패: [${e.code ?? e.name}] ${e.message}`);
  }
}
if (config.deepl.apiKey) {
  const tr = createTranslator({ ...config.deepl, cacheFile: null }, { fetchImpl });
  const r = await tr.translate('A farming simulation game where you build your own farm with friends.');
  log(r.translated ? `✅ DeepL 번역 성공: ${r.text}` : `❌ DeepL 번역 실패: ${r.error}`);
} else {
  log('⏭ .env 에 DEEPL_API_KEY 가 없어 번역 확인을 건너뜀 (소개는 원문으로 표시됨)');
}

// ── 6. RAWG 평균 플레이 시간 (진단) ──
section('6. RAWG 평균 플레이 시간');
if (!config.rawg.apiKey) {
  log('⏭ .env 에 RAWG_API_KEY 가 없어 건너뜀 → npm run prefill:playtime 으로 플레이 시간을 받을 수 없음');
} else if (!config.igdb.clientId || !config.igdb.clientSecret) {
  log('⏭ IGDB 설정이 없어 건너뜀');
} else {
  const rawg = createRawgProvider(config.rawg, { fetchImpl });
  const igdb = createIgdbProvider(config.igdb, { fetchImpl });
  const REASON = { NAME: '이름이 같은 게임이 RAWG 검색 결과에 없음', YEAR: '이름은 같지만 출시 연도가 2년 이상 다름', NO_PLAYTIME: 'RAWG에 플레이 시간 값이 없음(0)', NO_ENGLISH_NAME: '영문 이름 없음' };
  try {
    const games = (await igdb.browse('popular', { limit: 10 })).games.concat((await igdb.browse('recent', { limit: 5 })).games);
    let ok = 0;
    for (const g of games) {
      const r = await rawg.lookup({ names: [...(g.altNames || []), g.originalTitle, g.title], releaseDate: g.releaseDate });
      if (r.value) ok++;
      log(` - ${g.title}${g.originalTitle ? ` (${g.originalTitle})` : ''} [${g.releaseDate?.slice(0, 4) ?? '연도 없음'}] → ${r.value ? `✅ 약 ${r.value.hours}시간` : `❌ ${REASON[r.reason] ?? r.reason}`}`);
      if (!r.value) log(`     RAWG 검색 결과: ${r.candidates.join(' | ') || '(없음)'}`);
    }
    log(`${games.length}개 중 ${ok}개 플레이 시간 확인`);
  } catch (e) {
    log(`❌ 실패: ${e.message}`);
  }
}

// ── 7. App Store (게임위 전용 모바일 게임 이미지) ──
section('7. App Store 검색 (게임위 모바일 게임 아이콘·링크)');
try {
  const grac = createGracProvider({ ...config.grac, display: 100, maxPages: 1 }, { fetchImpl });
  const mobile = (await grac.listGames()).filter((g) => g.platforms?.includes('mobile') && g.publisher).slice(0, 6);
  const store = createAppStoreProvider({}, { fetchImpl });
  let ok = 0;
  for (const g of mobile) {
    const results = await store.search(g.title);
    const m = matchApp(results, { title: g.title, publisher: g.publisher });
    if (m) ok++;
    log(` - ${g.title} / ${g.publisher} → ${m ? `✅ ${m.trackName} (${m.sellerName || m.artistName})` : '❌ 같은 앱 없음'}`);
    if (!m) log(`     App Store 검색 결과: ${results.slice(0, 5).map((r) => `${r.trackName} / seller=${r.sellerName ?? '-'} / artist=${r.artistName ?? '-'}`).join(' | ') || '(없음)'}`);
    await new Promise((r) => setTimeout(r, 3500)); // 분당 약 20건 제한 지키기
  }
  log(`${mobile.length}개 중 ${ok}개 연결`);
} catch (e) {
  log(`❌ 실패: ${e.message}`);
}

// ── 8. 게임위 전체 목록 색인 + IGDB 중복 확인 (나만의 게임 찾기) ──
section('8. 게임위 전체 목록 색인 · IGDB에 있는지 확인');
try {
  const { createGracProvider } = await import('../server/providers/gracProvider.js');
  const g = createGracProvider(config.grac, { fetchImpl });
  const t0 = Date.now();
  const page = await g.fetchPage({ pageno: 1, display: 1000 });
  log(`1000건 한 페이지: ${Date.now() - t0}ms, 사용 가능 ${page.games.length}건 / 전체 ${page.total}건 → 전체 색인에 ${Math.ceil(page.total / 1000)}페이지 필요`);
  const ig = createIgdbProvider(config.igdb ?? {}, { fetchImpl });
  if (ig.configured) {
    const sample = [...new Set(page.games.map((x) => x.title))].slice(0, 12);
    const tF = Date.now();
    const found = await ig.findTitles(sample);
    log(`IGDB 이름 확인 12개 걸린 시간: ${Date.now() - tF}ms`);
    log(`최근 게임위 제목 12개 중 IGDB에서 같은 이름이 나온 것: ${found.length ? [...new Set(found)].join(' | ') : '없음'}`);
    const known = await ig.findTitles(['스타듀 밸리', 'Tetris']);
    log(`확인용(있어야 정상) 스타듀 밸리 · Tetris → ${known.length ? '✅ ' + [...new Set(known)].slice(0, 6).join(' | ') : '❌ 못 찾음'}`);
  }
} catch (e) {
  log(`❌ 실패: [${e.code ?? e.name}] ${e.message}`);
}

// ── 9. 추천 인원 AI 추정 (Gemini) ──
section('9. 추천 인원 (IGDB 협동 인원 / AI 추정)');
try {
  const { createPartySize, GEMINI_API_BASE } = await import('../server/services/partySize.js');
  const ps = createPartySize({ ...(config.gemini ?? {}), live: true, waitMs: 120_000, dataFile: null, legacyCacheFile: null }, { fetchImpl, log });
  log(`Gemini 키 설정=${ps.configured}, 모델=${ps.model}`);
  if (ps.configured) {
    const r = await fetchImpl(`${GEMINI_API_BASE}/models?pageSize=100`, { headers: { 'x-goog-api-key': config.gemini.apiKey } });
    const body = await r.json().catch(() => null);
    if (!r.ok) log(`❌ 모델 목록 조회 실패: HTTP ${r.status} ${body?.error?.message ?? ''}`);
    else log(`사용 가능한 Flash 모델: ${(body.models || []).map((m) => m.name.replace('models/', '')).filter((n) => /flash/.test(n)).join(', ')}`);
  }
  const ig = createIgdbProvider(config.igdb ?? {}, { fetchImpl });
  if (ig.configured) {
    const games = [];
    for (const t of ['PUBG: Battlegrounds', 'League of Legends', 'Minecraft', 'Overwatch 2', 'Stardew Valley', 'Apex Legends']) {
      const [g] = await ig.searchByTitle(t, 1);
      if (g) games.push(g);
    }
    const tAi = Date.now();
    const { games: filled, warning } = await ps.fill(games);
    log(`AI 추정 걸린 시간: ${Date.now() - tAi}ms (${games.length}개, 12개씩 동시에, thinking 끔)`);
    if (warning) log(`❌ ${warning}`);
    for (const g of filled) {
      const rec = g.recommendedPlayers;
      log(` - ${g.title}: 최대 ${g.players ? `${g.players.min}~${g.players.max}` : '정보 없음'} → 추천 ${rec ? `${rec.min}~${rec.max} [${rec.source}]` : '정보 없음'}`);
    }
  }
} catch (e) {
  log(`❌ 실패: [${e.code ?? e.name}] ${e.message}`);
}

const out = path.join(config.root, 'api-check.log');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`\n결과 저장: ${out}`);
