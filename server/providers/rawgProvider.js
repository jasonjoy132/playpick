// RAWG API — 게임 상세의 '평균 플레이 시간'
// 문서: https://rawg.io/apidocs
//   모든 요청에 key 파라미터 필요 (예: GET https://api.rawg.io/api/platforms?key=YOUR_API_KEY)
//   무료: 월 20,000건, 비상업 프로젝트. 데이터를 쓰는 모든 페이지에 RAWG 출처 표시 + 링크 필요
//   게임 목록: GET https://api.rawg.io/api/games?search=… → { results: [{ id, slug, name, released, playtime, … }] }
//   playtime: "Play time in hours"
// 같은 게임 판단 (엉뚱한 게임과 연결되지 않게):
//   - 이름: IGDB 원제·영문 별칭 중 하나와 RAWG 이름이 같음 (공백·기호 무시, 괄호·플랫폼 표기 제거 후 비교 포함)
//   - 연도: 두 출처 모두 출시 연도가 있으면 1년 차이까지 허용 (앞서 해보기/정식 출시 차이)
//   - 이름이 여러 개면 원제 → 별칭 순으로 최대 2번 검색, 검색 결과는 10개까지 확인
import { titleKeys } from './igdbProvider.js';

export const RAWG_API = 'https://api.rawg.io/api';
const MAX_SEARCHES = 2;

/** 왜 못 찾았는지(진단용) */
export function matchRawg(results, wanted, year) {
  const keys = new Set(wanted.flatMap(titleKeys));
  const sameName = results.filter((r) => titleKeys(r.name).some((k) => keys.has(k)));
  if (!sameName.length) return { match: null, reason: 'NAME' };
  const y = year ? Number(year) : null;
  const ok = sameName.filter((r) => !y || !r.released || Math.abs(Number(String(r.released).slice(0, 4)) - y) <= 1);
  if (!ok.length) return { match: null, reason: 'YEAR' };
  // 연도가 정확히 같은 것 우선
  ok.sort((a, b) => (y ? Math.abs(Number(String(a.released || '').slice(0, 4)) - y) - Math.abs(Number(String(b.released || '').slice(0, 4)) - y) : 0));
  const m = ok[0];
  if (!(Number(m.playtime) > 0)) return { match: m, reason: 'NO_PLAYTIME' };
  return { match: m, reason: null };
}

export function createRawgProvider(cfg = {}, { fetchImpl = globalThis.fetch, now = () => Date.now(), cacheTtlSec = 86400 } = {}) {
  const configured = Boolean(cfg.apiKey);
  const cache = new Map();

  async function search(name) {
    const url = new URL(`${RAWG_API}/games`);
    url.searchParams.set('key', cfg.apiKey);
    url.searchParams.set('search', name);
    url.searchParams.set('page_size', '10');
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`RAWG HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body?.results) ? body.results : [];
  }

  /** @returns {{ value: {hours,url,name}|null, reason: string|null, candidates: string[] }} */
  async function lookup({ names, releaseDate }) {
    const wanted = [...new Set(names.filter(Boolean))];
    if (!configured) return { value: null, reason: 'NOT_CONFIGURED', candidates: [] };
    if (!wanted.length) return { value: null, reason: 'NO_NAME', candidates: [] };
    const year = releaseDate ? String(releaseDate).slice(0, 4) : null;
    let last = { match: null, reason: 'NAME' };
    const seen = [];
    // 한글이 아닌 이름으로만 검색 (RAWG는 영문 이름 위주)
    const queries = wanted.filter((n) => !/[가-힣]/.test(n)).slice(0, MAX_SEARCHES);
    for (const q of queries) {
      const results = await search(q);
      seen.push(...results.map((r) => `${r.name} (${String(r.released || '').slice(0, 4) || '연도 없음'}, ${r.playtime ?? 0}h)`));
      last = matchRawg(results, wanted, year);
      if (last.match) break;
    }
    if (!queries.length) last = { match: null, reason: 'NO_ENGLISH_NAME' };
    const m = last.match;
    const value = m && !last.reason ? { hours: Number(m.playtime), url: `https://rawg.io/games/${m.slug}`, name: m.name } : null;
    return { value, reason: last.reason, candidates: [...new Set(seen)].slice(0, 10) };
  }

  return {
    configured,
    lookup,
    /** @returns {Promise<{ hours: number, url: string, name: string } | null>} */
    async playtime(game) {
      if (!configured) return null;
      const key = `${game.names.filter(Boolean).join('|')}|${game.releaseDate ?? ''}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlSec * 1000) return hit.value;
      const { value } = await lookup(game);
      cache.set(key, { at: now(), value });
      return value;
    },
  };
}
