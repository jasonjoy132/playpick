// 게임물관리위원회 게임 검색 Open API 모듈 (IGDB에 없는 게임 추가 + 국내 등급분류 정보 보완용)
// 기준 문서: 게임위 Open API 가이드 https://www.grac.or.kr/OpenBook/OpenAPIGuide.aspx
//
// 요청 주소 : https://www.grac.or.kr/WebService/GameSearchSvc.asmx/game
//   (가이드의 '실제 호출' 예: .../GameSearchSvc.asmx/game?display=10&pageno=1
//    → 'op=game'은 주소의 /game 경로로 지정되므로 쿼리에 따로 넣지 않습니다.)
// 요청 변수 : display(필수, 최대 1000), pageno(필수),
//             gametitle, entname, rateno, startdate, enddate(yyyy-mm-dd) — 선택, 값이 있을 때만 전송
// 인증      : 가이드에 인증키 관련 변수가 없음 → 키 없이 호출
// 호출 제한 : 가이드에 명시 없음 → 캐시(GRAC_CACHE_TTL)·페이지 수 제한(GRAC_MAX_PAGES)으로 호출 최소화
// 응답(XML) : <result> tcount, pageno, res_date, item[]
//               item: rateno, rateddate, gametitle, orgname, entname, summary, givenrate,
//                     genre, platform, descriptors, cancelstatus(True/False), canceledddate
//             오류 시 <error><message/><error_code/></error>
//
// 이 API에는 플레이 인원수·구매처·이미지 정보가 없으므로 해당 값은 null/빈 배열(정보 없음)로 둡니다.
import { xml2js } from 'xml-js';
import { DataSourceError } from './errors.js';
import { mapGracValue, PLATFORMS, GENRES } from '../services/taxonomy.js';

export const GRAC_DEFAULT_URL = 'https://www.grac.or.kr/WebService/GameSearchSvc.asmx/game';

const text = (node) => {
  if (node == null) return null;
  const v = typeof node === 'object' ? node._text ?? node._cdata : node;
  if (v == null) return null;
  const s = String(Array.isArray(v) ? v.join('') : v).trim();
  return s === '' ? null : s;
};

const isTrue = (v) => String(v ?? '').trim().toLowerCase() === 'true';

export function gracItemToGame(item) {
  const rateno = text(item.rateno);
  const platformRaw = text(item.platform);
  const genreRaw = text(item.genre);
  return {
    id: `grac-${encodeURIComponent(rateno ?? '')}`,
    title: text(item.gametitle),
    isDemo: false,
    source: '게임물관리위원회',
    publisher: text(item.entname),
    summary: text(item.summary),
    platforms: mapGracValue(platformRaw, PLATFORMS),
    platformsRaw: platformRaw,
    genres: mapGracValue(genreRaw, GENRES),
    genresRaw: genreRaw,
    players: null, // 게임위 API는 플레이 인원 정보를 제공하지 않음
    recommendedPlayers: null, // → AI 추정 대상 (services/partySize.js). AI가 모르면 정보 없음
    rating: text(item.givenrate),
    ratingDate: text(item.rateddate),
    ratingNo: rateno,
    ratingOrg: text(item.orgname),
    contentDescriptors: text(item.descriptors),
    canceled: isTrue(text(item.cancelstatus)) || text(item.givenrate) === '등급취소',
    domesticRating: true,
    imageUrl: null,
    stores: [],
  };
}

/**
 * XML 문자열 → { total, games }
 * 원페이저의 '국내 이용 가능 게임' 기준에 따라 등급거부(등급분류번호 없음)·등급취소 게임은 제외합니다.
 */
export function parseGracXml(xml) {
  let doc;
  try {
    doc = xml2js(xml, { compact: true, trim: true });
  } catch {
    throw new DataSourceError('UPSTREAM_INVALID', '게임물관리위원회 API 응답을 해석할 수 없습니다.');
  }
  // ASMX 웹서비스가 결과를 문자열로 감싸 보내는 경우(<string>&lt;result&gt;...</string>) 대비
  const wrapped = text(doc?.string);
  if (!doc?.result && !doc?.error && wrapped && /<(result|error)[\s>]/.test(wrapped)) return parseGracXml(wrapped);
  if (doc?.error) {
    const msg = text(doc.error.message);
    const code = text(doc.error.error_code);
    throw new DataSourceError(
      'UPSTREAM_ERROR',
      `게임물관리위원회 API 오류${code ? ` [${code}]` : ''}${msg ? `: ${msg}` : ''}`,
    );
  }
  const result = doc?.result;
  if (!result) throw new DataSourceError('UPSTREAM_INVALID', '게임물관리위원회 API가 예상하지 못한 형식의 응답을 반환했습니다.');
  const items = result.item == null ? [] : Array.isArray(result.item) ? result.item : [result.item];
  const games = items.map(gracItemToGame).filter((g) => g.title && g.ratingNo && !g.canceled);
  return { total: Number(text(result.tcount)) || 0, games };
}

export function createGracProvider(cfg, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const baseUrl = cfg.url || GRAC_DEFAULT_URL;
  let cache = null; // { at, games }

  async function request(params, timeoutMs = 15_000) {
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/xml, text/xml' } });
    } catch (e) {
      if (e?.name === 'TimeoutError') throw new DataSourceError('UPSTREAM_TIMEOUT', '게임물관리위원회 API 응답이 지연되고 있습니다.', 504);
      throw new DataSourceError('UPSTREAM_NETWORK', '게임물관리위원회 API에 연결할 수 없습니다.');
    }
    const body = await res.text().catch(() => '');
    // 오류도 <error> XML로 오므로 본문을 먼저 해석해 메시지를 살림
    if (!res.ok && !body.includes('<error')) throw new DataSourceError('UPSTREAM_HTTP', `게임물관리위원회 API 오류 (HTTP ${res.status})`);
    return parseGracXml(body);
  }

  return {
    name: 'grac',
    label: '게임물관리위원회',
    isDemo: false,
    configured: true,
    /** 설정한 기간·페이지 수만큼 게임 목록을 불러와 캐시 */
    async listGames() {
      if (cache && now() - cache.at < cfg.cacheTtlSec * 1000) return cache.games;
      const games = [];
      for (let page = 1; page <= cfg.maxPages; page++) {
        const { total, games: pageGames } = await request({
          startdate: cfg.startDate,
          enddate: cfg.endDate,
          display: cfg.display,
          pageno: page,
        });
        games.push(...pageGames);
        if (page * cfg.display >= total) break;
      }
      cache = { at: now(), games };
      return games;
    },
    /** 한 페이지 조회 (전체 목록 색인용, 페이지가 커서 제한 시간을 길게) */
    fetchPage({ pageno, display = 1000, startdate } = {}) {
      return request({ display, pageno, startdate }, 90_000);
    },
    /** 게임물명으로 검색 (IGDB 게임의 국내 등급 보완용) */
    async searchByTitle(title) {
      if (!title) return [];
      // 같은 이름의 등급분류가 많아(재심의·플랫폼별) 본편이 뒤로 밀리지 않게 넉넉히
      const { games } = await request({ gametitle: title, display: 100, pageno: 1 });
      return games;
    },
    async getGame(id) {
      if (!id.startsWith('grac-')) return null;
      const cached = cache?.games.find((g) => g.id === id);
      if (cached) return cached;
      const rateno = decodeURIComponent(id.slice('grac-'.length));
      if (!rateno) return null;
      const { games } = await request({ rateno, display: 10, pageno: 1 });
      return games.find((g) => g.ratingNo === rateno) ?? null;
    },
  };
}
