// App Store 검색 API (애플 공식) — 게임위 전용 게임(주로 국내 모바일 게임)의 아이콘 이미지·App Store 링크 보완
// 문서: https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/
//   GET https://itunes.apple.com/search?term=…&country=kr&entity=software  (키 없음)
//   호출 제한: 분당 약 20건 (변경될 수 있음) → 상세 화면에서만, 결과는 하루 저장, 분당 15건으로 자체 제한
//   이용 조건: 애플 콘텐츠(이미지 등)는 해당 앱 홍보 용도로만, 'App Store에서 다운로드' 표시 옆에 사용
// 같은 게임 판단: 앱 이름(정규화·괄호/플랫폼 표기 제거)이 게임위 게임물명과 같고,
//                 개발사 이름(sellerName 또는 artistName)이 게임위 신청사와 같을 때만. 하나라도 다르면 붙이지 않음.
import { titleKeys } from './igdbProvider.js';

export const APPSTORE_SEARCH = 'https://itunes.apple.com/search';
const IMAGE_HOST = /^https:\/\/is\d+-ssl\.mzstatic\.com\//;
const STORE_HOST = /^https:\/\/apps\.apple\.com\//;

/** 회사 이름 정규화: (주)·주식회사·Co., Ltd. 등 제거 */
export function normCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|co\.?,?\s*ltd\.?|corp(oration)?\.?|inc\.?|limited|llc|company|games?\b/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

export function sameCompany(a, b) {
  const x = normCompany(a);
  const y = normCompany(b);
  if (x.length < 2 || y.length < 2) return false;
  return x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)));
}

/** 스크린샷 주소 (애플 이미지 서버만, 최대 6장). 주소의 …/392x696bb.jpg 에서 가로·세로를 읽음 */
export function screenshotsOf(app) {
  const urls = [...(app?.screenshotUrls || []), ...(app?.ipadScreenshotUrls || [])].filter((u) => IMAGE_HOST.test(String(u)));
  return [...new Set(urls)].slice(0, 6).map((url) => {
    const m = /\/(\d+)x(\d+)[a-z]*\.(?:jpg|jpeg|png|webp)$/i.exec(url);
    return { url, w: m ? Number(m[1]) : null, h: m ? Number(m[2]) : null };
  });
}

export function matchApp(results, { title, publisher }) {
  if (!publisher) return null;
  const keys = new Set(titleKeys(title));
  return (
    results.find(
      (r) =>
        titleKeys(r.trackName).some((k) => keys.has(k)) &&
        (sameCompany(r.sellerName, publisher) || sameCompany(r.artistName, publisher)),
    ) ?? null
  );
}

export function createAppStoreProvider(cfg = {}, { fetchImpl = globalThis.fetch, now = () => Date.now(), cacheTtlSec = 86400 } = {}) {
  const enabled = cfg.enabled !== false;
  const cache = new Map();
  let calls = [];
  const allow = () => {
    const t = now();
    calls = calls.filter((x) => t - x < 60_000);
    if (calls.length >= 15) return false;
    calls.push(t);
    return true;
  };

  async function search(term) {
    const url = new URL(APPSTORE_SEARCH);
    url.searchParams.set('term', term);
    url.searchParams.set('country', 'kr');
    url.searchParams.set('entity', 'software');
    url.searchParams.set('limit', '10');
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`App Store HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body?.results) ? body.results : [];
  }

  return {
    enabled,
    search,
    /**
     * @param {{ title: string, publisher: string|null }} game  게임위 게임물명·신청사
     * @returns {Promise<{ imageUrl: string|null, storeUrl: string, appName: string, seller: string } | null>}
     */
    async lookup(game) {
      if (!enabled || !game.title || !game.publisher) return null;
      const key = `${game.title}|${game.publisher}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < cacheTtlSec * 1000) return hit.value;
      if (!allow()) return null; // 분당 한도 초과: 이번엔 건너뜀(저장하지 않음)
      const m = matchApp(await search(game.title), game);
      const image = m?.artworkUrl512 || m?.artworkUrl100 || null;
      const value =
        m && STORE_HOST.test(String(m.trackViewUrl))
          ? { imageUrl: image && IMAGE_HOST.test(image) ? image : null, storeUrl: m.trackViewUrl, appName: m.trackName, seller: m.sellerName || m.artistName, screenshots: screenshotsOf(m) }
          : null;
      cache.set(key, { at: now(), value });
      return value;
    },
  };
}
