// 게임물관리위원회 전체 목록 색인
//  - '나만의 게임 찾기'에서 IGDB에 없는 국내 등급분류 게임도 찾기 위해, 게임위 API 전체(약 3만 건)를
//    1000건씩 받아 .cache/grac-index.json 에 저장해 둡니다. (게임위 API에는 장르·플랫폼 조건 검색이 없음)
//  - 서버가 켜지면 백그라운드로 준비하고, 요청은 기다리지 않습니다(준비 중이면 status 로 알림).
//  - 하루에 한 번 새로 등급분류된 것만(startdate) 추가로 받고, 7일마다 전체를 다시 받아
//    그사이 취소된 등급을 반영합니다.
import fs from 'node:fs';
import path from 'node:path';
import { collapseGrac } from '../services/catalog.js';
import { titleKeys } from './igdbProvider.js';

const DAY = 86_400_000;
const PAGE = 1000;

export function createGracIndex({ grac, cacheFile, now = () => Date.now(), concurrency = 3, log = () => {} }) {
  let data = load(); // { fullAt, updatedAt, games: [...] }
  let collapsed = data ? collapse(data.games) : null;
  let job = null;
  let progress = null; // { done, total }
  let lastError = null;

  function load() {
    if (!cacheFile) return null;
    try {
      const d = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (!Array.isArray(d?.games)) return null;
      // 예전에 저장된 항목에는 recommendedPlayers 키가 없음 → 있어야 AI 추천 인원 대상(needsAi)·적용이 됨
      d.games = d.games.map((g) => ('recommendedPlayers' in g ? g : { ...g, players: g.players ?? null, recommendedPlayers: null }));
      return d;
    } catch {
      return null;
    }
  }
  function save() {
    if (!cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch (e) {
      log(`[grac-index] 저장 실패: ${e.message}`);
    }
  }

  /** 같은 제목(기본 제목 기준)끼리 하나로 */
  function collapse(games) {
    const groups = new Map();
    for (const g of games) {
      const keys = titleKeys(g.title);
      const key = keys[keys.length - 1];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    }
    return [...groups.values()].map(collapseGrac);
  }

  async function withRetry(fn, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i >= tries) throw e;
      }
    }
  }

  async function fullBuild() {
    const first = await withRetry(() => grac.fetchPage({ pageno: 1, display: PAGE }));
    const pages = Math.ceil(first.total / PAGE);
    progress = { done: 1, total: pages };
    const results = [first.games];
    let next = 2;
    const worker = async () => {
      while (next <= pages) {
        const pageno = next++;
        const r = await withRetry(() => grac.fetchPage({ pageno, display: PAGE }));
        results[pageno - 1] = r.games;
        progress = { done: progress.done + 1, total: pages };
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(pages - 1, 0)) }, worker));
    return results.flat();
  }

  async function incremental() {
    // 마지막 갱신일 하루 전부터 새로 등급분류된 것만
    const since = new Date(data.updatedAt - DAY).toISOString().slice(0, 10);
    const fresh = [];
    for (let pageno = 1; ; pageno++) {
      const r = await withRetry(() => grac.fetchPage({ pageno, display: PAGE, startdate: since }));
      fresh.push(...r.games);
      if (pageno * PAGE >= r.total) break;
    }
    const byNo = new Map(data.games.map((g) => [g.ratingNo, g]));
    for (const g of fresh) byNo.set(g.ratingNo, g);
    return [...byNo.values()];
  }

  async function refresh() {
    const t = now();
    const full = !data || t - data.fullAt > 7 * DAY;
    const games = full ? await fullBuild() : await incremental();
    data = { fullAt: full ? t : data.fullAt, updatedAt: t, games };
    collapsed = collapse(games);
    progress = null;
    lastError = null;
    save();
    log(`[grac-index] ${full ? '전체' : '추가분'} 갱신 완료: ${games.length}건 → 제목 기준 ${collapsed.length}개`);
  }

  return {
    /** 오래됐거나 없으면 백그라운드 갱신 시작 (기다리지 않음) */
    ensure() {
      if (job) return job;
      if (data && now() - data.updatedAt < DAY) return null;
      job = refresh()
        .catch((e) => {
          lastError = e;
          progress = null;
          log(`[grac-index] 갱신 실패: ${e.message}`);
        })
        .finally(() => {
          job = null;
        });
      return job;
    },
    /** 'ready' | 'building' | 'error' + 제목 기준으로 합친 게임 목록 */
    snapshot() {
      if (collapsed) return { status: 'ready', games: collapsed, updatedAt: data.updatedAt };
      if (job) return { status: 'building', progress };
      return { status: lastError ? 'error' : 'building', error: lastError?.message ?? null, progress };
    },
  };
}
