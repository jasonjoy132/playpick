// 데이터 소스 선택
//  - demo : 데모 데이터(가상 게임)
//  - live : IGDB(기본 출처) + 게임물관리위원회 API(상세 화면의 국내 등급 보완, 검색에서 IGDB에 없는 게임, IGDB 실패 시 대체)
// live 에서 오류가 나면 데모로 몰래 대체하지 않습니다.
//  - 두 출처 중 하나만 실패: 나머지 결과 + 경고(warnings) 반환
//  - 모두 실패: 오류 반환
import { createDemoProvider } from '../providers/demoProvider.js';
import { createGracProvider } from '../providers/gracProvider.js';
import { createIgdbProvider, normTitle, baseTitle, titleKeys, titleVariants, platformClasses } from '../providers/igdbProvider.js';
import { createKrGameDbProvider } from '../providers/krGameDbProvider.js';
import { DataSourceError } from '../providers/errors.js';
import { createGracIndex } from '../providers/gracIndex.js';
import { evaluateGame } from './recommend.js';
import fs from 'node:fs';
import path from 'node:path';

const stripInternal = ({ matchNames, ...g }) => g;

/** 검색어가 게임 이름(원제·한국어명·별칭, 공백·기호 무시)에 들어 있는지 */
export function isRelevant(game, query) {
  const q = normTitle(query);
  if (!q) return false;
  const names = game.matchNames?.length ? game.matchNames : [game.title, game.originalTitle].filter(Boolean).map(normTitle);
  return names.some((n) => n.includes(q));
}

const uniq = (arr) => [...new Set(arr)];

/** 검색어와 이름이 얼마나 맞는지: 0 같음, 1 검색어로 시작, 2 검색어 포함, 3 그 밖 (공백·기호 무시, 괄호·플랫폼 표기 뗀 이름도 비교) */
export function searchScore(game, query) {
  const n = normTitle(query);
  if (!n) return 3;
  let best = 3;
  for (const name of [game.title, game.originalTitle]) {
    if (!name) continue;
    for (const t of titleKeys(name)) {
      if (t === n) return 0;
      if (t.startsWith(n)) best = Math.min(best, 1);
      else if (t.includes(n)) best = Math.min(best, 2);
    }
  }
  return best;
}

/**
 * 검색 결과 정렬: 이름이 더 잘 맞는 게임 먼저. 검색어로 시작하는 게임끼리는 이름이 짧은 것(본편) 먼저
 * 예: '메이플' → 메이플스토리 → 메이플스토리2 → 메이플스토리 M … 같은 점수 안에서는 원래 순서(IGDB 인기·관련도) 유지
 */
// 평가가 이만큼 이상인 유명한 게임은 이름에 검색어만 들어 있어도 맨 앞으로 (예: 'battleground' → PUBG: BATTLEGROUNDS)
const FAMOUS_RATINGS = 100;
export function rankSearch(games, query) {
  const qs = Array.isArray(query) ? query : [query];
  const len = (g) => Math.min(...[g.title, g.originalTitle].filter(Boolean).map((t) => normTitle(baseTitle(t)).length));
  const score = (g) => {
    const s = Math.min(...qs.map((q) => searchScore(g, q)));
    return s <= 2 && (g.globalRating?.count ?? 0) >= FAMOUS_RATINGS ? -1 : s;
  };
  return games
    .map((g, i) => ({ g, i, s: score(g) }))
    .sort((a, b) => a.s - b.s || (a.s <= 1 ? len(a.g) - len(b.g) : 0) || a.i - b.i)
    .map((x) => x.g);
}

/** 같은 제목의 게임위 항목 여러 개(플랫폼별·재심의 등)를 하나로 합침: 최신 등급분류를 기준으로 플랫폼·장르는 합집합 */
export function collapseGrac(entries) {
  if (entries.length === 1) return { ...entries[0], domesticRating: true };
  const sorted = [...entries].sort((x, y) => String(y.ratingDate || '').localeCompare(String(x.ratingDate || '')));
  const [latest] = sorted;
  const list = (k) => {
    const v = uniq(sorted.flatMap((e) => e[k] || []));
    return v.length ? v : null;
  };
  const raw = (k) => uniq(sorted.map((e) => e[k]).filter(Boolean)).join(', ') || null;
  return {
    ...latest,
    platforms: list('platforms'),
    platformsRaw: raw('platformsRaw'),
    genres: list('genres'),
    genresRaw: raw('genresRaw'),
    summary: sorted.find((e) => e.summary)?.summary ?? null,
    publisher: latest.publisher ?? sorted.find((e) => e.publisher)?.publisher ?? null,
    domesticRating: true,
    gracEntryCount: entries.length,
  };
}

/**
 * IGDB 게임을 기본으로, 게임위 게임을 합쳐 '게임 하나 = 카드 하나'로 만듦
 *  - 같은 게임 판단: 제목(정규화) 또는 기본 제목(괄호·'for Switch'·'모바일' 같은 플랫폼 표기 제거)이
 *    IGDB 이름·한국어 현지화명·별칭 중 하나와 같을 때
 *  - 같은 게임이면 카드는 IGDB 하나만 표시. 게임위 항목 중 플랫폼이 겹치는 것이 있으면
 *    그 항목의 국내 등급분류 정보(등급·번호·내용정보)와 한글 제목만 보완
 *    (플랫폼이 겹치는 항목이 없으면 등급은 붙이지 않음 — 같은 이름의 다른 판일 수 있어서)
 *  - IGDB에 없는 게임위 게임은 같은 제목끼리 하나로 합쳐 추가 (인원·이미지·구매처는 정보 없음)
 *  - IGDB에서 hidden(서비스 종료 등)인 게임은 결과에서 제외
 */
export function mergeGames(igdbGames, gracGames) {
  const result = igdbGames.map((g) => ({ ...g }));
  const index = new Map();
  result.forEach((g, i) => (g.matchNames || titleKeys(g.title)).forEach((n) => index.has(n) || index.set(n, i)));

  const matched = new Map(); // IGDB index → 게임위 항목들
  const gracOnly = new Map(); // 기본 제목 키 → 게임위 항목들
  for (const gr of gracGames) {
    const keys = titleKeys(gr.title);
    let i = keys.map((k) => index.get(k)).find((x) => x != null);
    // 번역한 영문 이름(enTitle)으로도 찾되, 번역은 틀릴 수 있어 플랫폼이 겹칠 때만 같은 게임으로 봄
    // 플랫폼 비교: 분류값(pc·mobile·console·arcade)으로, 안 겹치면 IGDB 원래 플랫폼 이름(예: Xbox 360 — 분류에 없는 옛 기기)으로 한 번 더
    const samePlatforms = (ig) =>
      !ig.platforms?.length ||
      !gr.platforms?.length ||
      gr.platforms.some((p) => ig.platforms.includes(p)) ||
      (Boolean(ig.platformsRaw) && gr.platforms.some((p) => platformClasses(ig.platformsRaw.split(/,\s*/)).includes(p)));
    if (i == null && gr.enTitle) {
      const j = titleKeys(gr.enTitle).map((k) => index.get(k)).find((x) => x != null);
      if (j != null && samePlatforms(result[j])) i = j;
    }
    // 제목에서 꺼낸 이름 후보로도('Portal 2(포탈 2)_PC' → Portal 2·포탈 2) — 목록의 IGDB 확인과 같은 규칙, 플랫폼이 겹칠 때만
    if (i == null) {
      for (const v of titleVariants(gr.title)) {
        const j = index.get(normTitle(v));
        if (j != null && samePlatforms(result[j])) {
          i = j;
          break;
        }
      }
    }
    if (i != null) {
      if (!matched.has(i)) matched.set(i, []);
      matched.get(i).push(gr);
    } else {
      const key = keys[keys.length - 1];
      if (!gracOnly.has(key)) gracOnly.set(key, []);
      gracOnly.get(key).push(gr);
    }
  }

  for (const [i, entries] of matched) {
    const ig = result[i];
    if (ig.ratingNo) continue;
    const overlaps = (gr) => !ig.platforms?.length || !gr.platforms?.length || gr.platforms.some((p) => ig.platforms.includes(p));
    const gr = entries
      .filter(overlaps)
      .sort((x, y) => String(y.ratingDate || '').localeCompare(String(x.ratingDate || '')))[0];
    // 게임위 한글 제목: 'Portal 2(포탈 2)_PC' 처럼 섞여 있으면 한글 이름 후보(포탈 2)만
    const hangul = /[\uac00-\ud7a3]/;
    const koTitle = entries.flatMap((e) => (hangul.test(e.title) ? titleVariants(e.title).filter((v) => hangul.test(v)) : []))[0];
    result[i] = {
      ...ig,
      // IGDB 제목이 한글이 아니면 게임위 한글 제목을 함께 표시
      originalTitle: ig.originalTitle ?? (koTitle && normTitle(koTitle) !== normTitle(ig.title) ? koTitle : null),
      ...(gr
        ? {
            rating: gr.rating ?? ig.rating,
            ratingDate: gr.ratingDate,
            ratingNo: gr.ratingNo,
            ratingOrg: gr.ratingOrg,
            contentDescriptors: gr.contentDescriptors,
            ratingSource: '게임물관리위원회',
            domesticRating: true,
            platformsRaw: ig.platformsRaw ?? gr.platformsRaw,
            platforms: ig.platforms ?? gr.platforms,
            genres: ig.genres ?? gr.genres,
            genresRaw: ig.genresRaw ?? gr.genresRaw,
            publisher: ig.publisher ?? gr.publisher,
            summary: ig.summary ?? gr.summary,
          }
        : {}),
    };
  }
  for (const entries of gracOnly.values()) result.push(collapseGrac(entries));

  // 서비스 종료 등으로 숨길 IGDB 게임 제외(같은 제목의 게임위 항목도 위에서 이 게임에 묶였으므로 함께 빠짐), 같은 id 중복 제거
  const seen = new Set();
  return result.filter((g) => !g.hidden && !seen.has(g.id) && seen.add(g.id)).map(stripInternal);
}

export function createCatalog(config, deps = {}) {
  if (config.dataSource !== 'live') {
    const demo = createDemoProvider();
    return {
      meta: { dataSource: 'demo', isDemo: true, sources: [demo.label] },
      async listGames() {
        return { games: await demo.listGames(), warnings: [] };
      },
      async featured() {
        return { games: await demo.listGames(), warnings: [] };
      },
      async gracMatches() {
        return { status: 'unavailable' };
      },
      domesticGames: () => [],
      warmUp() {},
      /** 데모: 전체 목록이 작아 listGames 로 충분 */
      async findMatches() {
        return null;
      },
      async browse(kind, { genre, platform, offset = 0, limit = 24 } = {}) {
        if (kind === 'recent' || kind === 'upcoming' || kind === 'top') {
          return { games: [], hasMore: false, warnings: ['데모 데이터에는 출시일·글로벌 평점 정보가 없어 이 목록을 만들 수 없어요. 실제 데이터(IGDB)를 연결하면 표시됩니다.'] };
        }
        const all = (await demo.listGames()).filter((g) => (!genre || g.genres?.includes(genre)) && (!platform || g.platforms?.includes(platform)));
        return { games: all.slice(offset, offset + limit), hasMore: offset + limit < all.length, warnings: [] };
      },
      async getMany(ids) {
        const all = await demo.listGames();
        return ids.map((id) => all.find((g) => g.id === id)).filter(Boolean);
      },
      async search(q) {
        const n = normTitle(q);
        return { games: (await demo.listGames()).filter((g) => normTitle(g.title).includes(n)), warnings: [] };
      },
      getGame: (id) => demo.getGame(id),
    };
  }

  const igdb = deps.igdb ?? createIgdbProvider(config.igdb ?? {}, deps);
  const grac = deps.grac ?? createGracProvider(config.grac, deps);
  const kr = deps.kr ?? createKrGameDbProvider(config.krGameDb);
  const sources = [...(igdb.configured ? [igdb.label] : []), grac.label, ...(kr.configured ? [kr.label] : [])];
  const gc = config.grac ?? {};
  const gracIndex =
    deps.gracIndex ?? (gc.indexEnabled && grac.fetchPage ? createGracIndex({ grac, cacheFile: gc.indexFile, log: (m) => console.log(m) }) : null);
  const igdbCheck = createExistenceCache(gc.igdbCheckFile);
  const filtered = new Map(); // 조건별 후보 목록 (색인 갱신 시점 기준)

  return {
    meta: { dataSource: 'live', isDemo: false, sources },

    /**
     * 추천 후보: IGDB 게임만 사용 (게임위 전용 게임은 정보가 부족해 결과를 어지럽혀서 제외)
     * IGDB가 없거나 실패하면 그때만 게임위 목록으로 대신 보여 줌
     */
    async listGames(criteria = { players: null, platforms: [], genres: [] }) {
      let reason;
      if (igdb.configured) {
        try {
          return { games: (await igdb.searchByCriteria(criteria)).filter((g) => !g.hidden).map(stripInternal), warnings: [] };
        } catch (e) {
          reason = e;
        }
      }
      const games = await kr.enrich(await grac.listGames());
      const why = reason ? `IGDB 데이터를 불러오지 못해 (${reason.message})` : 'IGDB 설정이 없어';
      return { games: games.map((g) => ({ ...g, domesticRating: true })), warnings: [`${why} 게임물관리위원회 등급분류 목록으로 대신 보여 드려요.`] };
    },

    /**
     * 모든 조건 일치 게임을 IGDB 전체에서 페이지 단위로 조회
     * IGDB 미설정이면 null, 실패하면 { failed } → 호출 쪽에서 기존 후보 목록 방식으로 대체
     */
    async findMatches(criteria, opt) {
      if (!igdb.configured || !igdb.findMatches) return null;
      try {
        const r = await igdb.findMatches(criteria, opt);
        return { ...r, games: r.games.filter((g) => !g.hidden).map(stripInternal) };
      } catch (e) {
        return { failed: e };
      }
    },

    /** 화면에 게임위 카드로 보이는 게임 = 색인 중 IGDB에 있다고 확인되지 않은 것 (색인 준비 전이면 빈 배열) */
    domesticGames() {
      const snap = gracIndex?.snapshot();
      if (!snap || snap.status !== 'ready') return [];
      return snap.games.filter((g) => igdbCheck.known(g.title) !== true).map(stripInternal);
    },

    /** 서버 시작 시 게임위 전체 목록 색인 준비(백그라운드) */
    warmUp() {
      if (igdb.configured) gracIndex?.ensure();
    },

    /**
     * 나만의 게임 찾기: IGDB에 없는 게임위 게임
     *  - 선택한 플랫폼·장르가 게임위 자료로 모두 '일치'인 게임만 (게임위에는 인원 정보가 없어 인원은 '정보 없음')
     *  - 최신 등급분류 순으로 훑으며 IGDB에 같은 이름(이름·별칭·한국어명)이 있는 게임은 제외
     */
    async gracMatches(criteria, { offset = 0, limit = 24, keep = null } = {}) {
      if (!igdb.configured || !gracIndex) return { status: 'unavailable' };
      gracIndex.ensure();
      const snap = gracIndex.snapshot();
      if (snap.status !== 'ready') return { status: snap.status, progress: snap.progress, error: snap.error };
      const keys = ['platforms', 'genres'].filter((k) => criteria[k].length);
      if (!keys.length) return { status: 'ready', items: [], total: 0, hasMore: false, nextOffset: 0, reason: 'NEED_PLATFORM_OR_GENRE' };

      const fkey = JSON.stringify([snap.updatedAt, criteria.platforms, criteria.genres]);
      let list = filtered.get(fkey);
      if (!list) {
        list = snap.games
          .map((game) => ({ game, evaluation: evaluateGame(game, criteria) }))
          .filter(({ evaluation }) => evaluation.checks.every((c) => c.key === 'players' || c.status === 'match'))
          .sort((a, b) => String(b.game.ratingDate || '').localeCompare(String(a.game.ratingDate || '')));
        if (filtered.size > 50) filtered.clear();
        filtered.set(fkey, list);
      }

      // 목록에 보여도 되는 게임만(서비스 종료·출시 예정·상태 모름 제외) — 저장된 판단이 바뀔 수 있어 캐시하지 않고 매번 거름
      if (keep) list = list.filter((x) => keep(x.game));
      const items = [];
      let pos = offset;
      const MAX_SCAN = limit * 4;
      // 12개씩 3묶음을 동시에 IGDB에 확인 (차례로 하면 기다리는 시간이 묶음 수만큼 늘어남)
      while (items.length < limit && pos < list.length && pos - offset < MAX_SCAN) {
        const start = pos;
        const wave = list.slice(start, Math.min(start + 36, offset + MAX_SCAN));
        const chunks = [];
        for (let i = 0; i < wave.length; i += 12) chunks.push(wave.slice(i, i + 12));
        const rawOf = new Map(wave.map((x) => [x.game.title, x.game.platformsRaw]));
        const find = (names) => (igdb.findTitleGames ? igdb.findTitleGames(names) : igdb.findTitles(names));
        const sets = await Promise.all(chunks.map((c) => igdbCheck.check(c.map((x) => x.game.title), find, { platformsOf: (t) => rawOf.get(t) })));
        const exists = new Set(sets.flatMap((x) => [...x]));
        pos = start + wave.length;
        for (let i = 0; i < wave.length; i++) {
          if (items.length >= limit) {
            pos = start + i; // 남은 항목은 다음 페이지에서 (확인 결과는 캐시돼 추가 호출 없음)
            break;
          }
          const x = wave[i];
          if (!exists.has(x.game.title)) items.push({ ...x, game: stripInternal(x.game) });
        }
      }
      igdbCheck.save();
      return { status: 'ready', items, total: list.length, nextOffset: pos, hasMore: pos < list.length, updatedAt: snap.updatedAt };
    },

    /** 첫 화면: IGDB 인기 게임 (IGDB 미설정·실패 시 게임위 최신 등급분류 게임) */
    async featured() {
      if (igdb.configured) {
        try {
          return { games: (await igdb.featured(30)).filter((g) => !g.hidden).map(stripInternal), warnings: [] };
        } catch (e) {
          const games = (await grac.listGames()).slice(0, 30);
          return { games, warnings: [`IGDB 데이터를 불러오지 못해 게임물관리위원회 최신 등급분류 게임을 표시합니다. (${e.message})`] };
        }
      }
      const games = (await grac.listGames()).slice(0, 30);
      return { games, warnings: ['IGDB 설정이 없어 게임물관리위원회 최신 등급분류 게임을 표시합니다.'] };
    },

    /** 메뉴별 목록 (IGDB 기준) */
    async browse(kind, opt) {
      if (!igdb.configured) throw new DataSourceError('IGDB_NOT_CONFIGURED', '이 목록은 IGDB 데이터로 만들어요. .env 에 IGDB 키를 설정해 주세요.', 503);
      return { ...(await igdb.browse(kind, opt)), warnings: [] };
    },
    /** 회원 평점 랭킹 보강: IGDB 게임 정보 한 번에 조회 (실패하면 리뷰에 저장된 제목·표지로 표시) */
    async getMany(ids) {
      const igdbIds = ids.filter((id) => id.startsWith('igdb-'));
      if (!igdb.configured || !igdbIds.length) return [];
      try {
        return await igdb.getMany(igdbIds);
      } catch {
        return [];
      }
    },

    /** 게임명 검색: IGDB 검색 + 게임위 게임물명 검색 (IGDB 기준, 게임위는 IGDB에 없는 게임만 추가) */
    /**
     * 게임명 검색
     *  - IGDB 결과 중 검색어와 이름이 실제로 맞는 게임(원제·한국어명·별칭에 검색어 포함)이 있으면 → IGDB 게임만
     *    (같은 게임이 게임위 항목으로 한 번 더 나오는 것 방지)
     *  - IGDB 결과가 없거나, 이름이 비슷하기만 한 엉뚱한 게임뿐이면 → 게임위 결과를 먼저, 그 뒤에 IGDB 결과
     *    (예: '로스트아크' 검색 시 IGDB에 한국어 이름이 없으면 게임위의 '로스트아크'가 숨지 않게)
     */
    /**
     * 게임 이름 검색. translate 가 있으면 한글↔영문 검색어를 함께 써서 언어와 상관없이 같은 결과가 나오게 함
     *  - IGDB: 원래 검색어 + 영문 검색어,  게임위: 원래 검색어 + 한글 검색어
     *  - 게임위 한글 제목은 영문으로 번역해 IGDB 게임과 같은 게임인지 한 번 더 확인(플랫폼이 겹칠 때만)
     * @param {string} q
     * @param {{ translate?: (texts: string[], target: 'EN'|'KO') => Promise<(string|null)[]> }} [opt]
     */
    async search(q, { translate } = {}) {
      const hangul = /[가-힣]/.test(q);
      let alt = null;
      if (translate) {
        try {
          [alt] = await translate([q], hangul ? 'EN' : 'KO');
        } catch {
          alt = null;
        }
        if (alt && normTitle(alt) === normTitle(q)) alt = null;
      }
      const igdbQs = [q, ...(alt && hangul ? [alt] : [])];
      const gracQs = [q, ...(alt && !hangul ? [alt] : [])];
      const [i, g] = await Promise.allSettled([
        igdb.configured
          ? Promise.all(igdbQs.map((x) => igdb.searchByTitle(x, 30))).then((rs) => rs.flat())
          : Promise.reject(new Error('IGDB 설정이 없습니다.')),
        Promise.all(gracQs.map((x) => grac.searchByTitle(x))).then((rs) => rs.flat()),
      ]);
      if (i.status === 'rejected' && g.status === 'rejected') throw igdb.configured ? i.reason : g.reason;
      const warnings = [];
      if (i.status === 'rejected' && igdb.configured) warnings.push(`IGDB 검색에 실패해 게임물관리위원회 결과만 표시합니다. (${i.reason.message})`);
      if (g.status === 'rejected') warnings.push(`게임물관리위원회 검색에 실패해 IGDB 결과만 표시합니다. (${g.reason.message})`);
      const seenI = new Set();
      const igdbRaw = (i.status === 'fulfilled' ? i.value : []).filter((x) => !seenI.has(x.id) && seenI.add(x.id));
      const seenG = new Set();
      let gracRaw = (g.status === 'fulfilled' ? g.value : []).filter((x) => !seenG.has(x.id) && seenG.add(x.id));
      // 게임위 한글 제목 → 영문 (IGDB 게임과 이어 붙이기용, 번역 결과는 캐시)
      if (translate && gracRaw.length && igdbRaw.length) {
        try {
          const en = await translate(gracRaw.map((x) => x.title), 'EN');
          gracRaw = gracRaw.map((x, k) => (en[k] && en[k] !== x.title ? { ...x, enTitle: en[k] } : x));
        } catch {
          /* 번역 실패: 제목 그대로 비교 */
        }
      }
      const merged = mergeGames(igdbRaw, gracRaw);
      const igdbGames = merged.filter((x) => x.source === 'IGDB');
      const gracOnly = merged.filter((x) => x.source !== 'IGDB');
      const queries = [q, ...(alt ? [alt] : [])];
      const score = (x) => Math.min(...queries.map((qq) => searchScore(x, qq)));
      const relevant = igdbRaw.some((x) => queries.some((qq) => isRelevant(x, qq)));
      // IGDB에 이름이 맞는 게임이 있어도, 이름에 검색어가 들어간 게임위 게임은 함께 보여 줌
      const gracShown = relevant ? gracOnly.filter((x) => score(x) < 3) : gracOnly;
      return { games: rankSearch([...gracShown, ...igdbGames], queries), warnings, translatedQuery: alt };
    },

    /** IGDB 이용자 기록 플레이 시간 (IGDB 게임만, 실패하면 null) */
    async timeToBeat(id) {
      if (!String(id).startsWith('igdb-') || !igdb.configured || !igdb.timeToBeat) return null;
      try {
        return await igdb.timeToBeat(id);
      } catch {
        return null;
      }
    },

    async getGame(id) {
      if (id.startsWith('igdb-')) {
        if (!igdb.configured) return null;
        const game = await igdb.getGame(id);
        if (!game) return null;
        if (game.ratingNo) return stripInternal(game);
        // 상세 화면: 게임위에서 같은 제목을 찾아 국내 등급 보완 (실패해도 IGDB 정보는 표시)
        try {
          const names = [...new Set([game.title, game.originalTitle].filter(Boolean))];
          const found = (await Promise.all(names.map((t) => grac.searchByTitle(t)))).flat();
          const [merged] = mergeGames([game], found);
          return { ...merged, ratingLookup: merged.ratingNo ? 'found' : 'not_found' };
        } catch {
          return { ...stripInternal(game), warnings: ['게임물관리위원회 등급 정보를 불러오지 못했습니다.'] };
        }
      }
      const base = await grac.getGame(id);
      if (!base) return null;
      const [game] = await kr.enrich([base]);
      return { ...game, domesticRating: true };
    },
  };
}

/**
 * 게임위 제목 → IGDB에 있는지 여부 캐시 (파일 저장, 30일)
 * check(titles, find): IGDB에 있는 제목들의 Set
 */
/**
 * 게임위 플랫폼(원문)과 IGDB 플랫폼 종류가 겹치는지. 어느 한쪽이라도 모르면 맞는 것으로
 * 게임위: 'PC/온라인 게임' · '모바일 게임' · '비디오 게임'(콘솔) · '아케이드 게임' (여러 개면 쉼표로)
 * IGDB: pc · mobile · console · arcade (findTitleGames 가 분류)
 */
export function samePlatform(gracRaw, igdbClasses) {
  if (!gracRaw || !igdbClasses?.length) return true;
  const g = new Set();
  if (/pc|온라인/i.test(gracRaw)) g.add('pc');
  if (/모바일/.test(gracRaw)) g.add('mobile');
  if (/비디오|콘솔/.test(gracRaw)) g.add('console');
  if (/아케이드/.test(gracRaw)) g.add('arcade');
  return !g.size || igdbClasses.some((c) => g.has(c));
}

export function createExistenceCache(file) {
  const TTL = 30 * 86_400_000;
  let map = new Map();
  let dirty = false;
  try {
    if (file) map = new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch {
    /* 없으면 새로 */
  }
  // v2: 제목 후보(괄호 안 이름·플랫폼 표기 제거·전각 기호 정리)와 slug로 찾음. 예전 방식으로 '없음'이 된 항목은 다시 확인
  const VERSION = 2;
  const fresh = (e) => e && Date.now() - e.at < TTL && (e.exists || e.v === VERSION);
  return {
    /**
     * @param {string[]} titles 게임위 제목들
     * @param {(names: string[]) => Promise<Array<string | { names: string[], platforms?: string[] }>>} find IGDB에서 이름으로 찾기
     * @param {{ platformsOf?: (title: string) => string|null }} opt 게임위 플랫폼(원문). 괄호 안 이름 등 '꺼낸 이름'으로만 맞을 때는
     *   플랫폼도 맞아야 같은 게임으로 봄(예: 'Greedy Snake' 같은 흔한 이름이 다른 게임과 연결되지 않게)
     */
    async check(titles, find, { platformsOf } = {}) {
      const todo = titles.filter((t) => !fresh(map.get(t)));
      if (todo.length) {
        const queryNames = [...new Set(todo.flatMap((t) => [t, baseTitle(t), ...titleVariants(t)]))];
        const games = (await find(queryNames)).map((x) => (typeof x === 'string' ? { names: [x], platforms: null } : x));
        const byKey = new Map(); // 정규화 이름 → 그 이름을 가진 IGDB 게임들의 플랫폼
        for (const g of games) for (const k of new Set(g.names.flatMap((n) => titleKeys(n)))) (byKey.get(k) ?? byKey.set(k, []).get(k)).push(g.platforms);
        for (const t of todo) {
          const direct = titleKeys(t).some((k) => byKey.has(k)); // 예전 방식: 제목·기본 제목이 그대로 같음
          const derived =
            !direct &&
            titleVariants(t)
              .map(normTitle)
              .some((k) => (byKey.get(k) ?? []).some((p) => samePlatform(platformsOf?.(t), p)));
          map.set(t, { exists: direct || derived, at: Date.now(), v: VERSION });
          dirty = true;
        }
      }
      return new Set(titles.filter((t) => map.get(t)?.exists));
    },
    /** 이미 확인한 결과만 (true: IGDB에 있음, false: 없음, undefined: 아직 모름) */
    known: (t) => (fresh(map.get(t)) ? map.get(t).exists : undefined),
    save() {
      if (!file || !dirty) return;
      dirty = false;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(Object.fromEntries(map)));
      } catch {
        /* 캐시 저장 실패는 무시 */
      }
    },
  };
}
