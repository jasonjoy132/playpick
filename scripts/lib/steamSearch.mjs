// Steam 상점 검색 결과(search/results, infinite=1)의 HTML 읽기
//  - 한 줄마다 앱 번호·이름·리뷰 수·무료 여부
//  - 무료: 가격 칸이 'free'(Free·Free To Play). 단 할인 전 가격이 있으면(100% 할인 이벤트) 원래 유료
//  - 유료: 최종 가격(data-price-final)이 0보다 큼
//  - 그 밖(판매 안 함·가격 없음)은 null(모름)
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function steamSearchFree(row) {
  const final = Number(row.match(/data-price-final="(\d+)"/)?.[1] ?? NaN);
  const hasOriginal = /discount_original_price/.test(row);
  if (/discount_final_price[^"]*\bfree\b/.test(row)) return hasOriginal ? false : true;
  if (final > 0) return false;
  if (final === 0 && hasOriginal) return false;
  return null;
}

/** @returns {{ id: string, name: string, reviews: number, free: boolean|null }[]} */
export function parseSteamSearch(html) {
  const out = [];
  for (const row of String(html).split('<a href=').slice(1)) {
    const id = row.match(/data-ds-appid="(\d+)"/)?.[1]; // 묶음 상품(번호 여러 개)은 빼고
    const name = row.match(/<span class="title">([^<]*)<\/span>/)?.[1];
    if (!id || !name) continue;
    const reviews = Number(decode(row.match(/data-tooltip-html="([^"]*)"/)?.[1] ?? '').match(/of the ([\d,]+) user reviews/)?.[1]?.replace(/,/g, '') ?? 0);
    out.push({ id, name: decode(name), reviews, free: steamSearchFree(row) });
  }
  return out;
}

/**
 * IGDB 게임 하나에 Steam 앱이 여럿 붙어 있으면(편집판 등) 리뷰가 가장 많은 앱의 값
 * @param {{ game: number, uid: string }[]} links IGDB external_games
 * @param {Record<string, { free: boolean|null, reviews: number }>} apps
 * @returns {Map<string, { free: boolean, appid: string }>} 키 'igdb-<id>'
 */
export function pickByGame(links, apps) {
  const best = new Map();
  for (const { game, uid } of links) {
    const a = apps[uid];
    if (!a || typeof a.free !== 'boolean') continue;
    const key = `igdb-${game}`;
    const cur = best.get(key);
    if (!cur || a.reviews > cur.reviews) best.set(key, { free: a.free, appid: String(uid), reviews: a.reviews });
  }
  return new Map([...best].map(([k, v]) => [k, { free: v.free, appid: v.appid }]));
}
