/**
 * Steam 공식 트레일러(영상 파일 주소) — 홈 첫 화면 배경을 YouTube 대신 바로 재생하려고 씀
 * - IGDB가 준 구매처 중 Steam 상점 주소(store.steampowered.com/app/<번호>)가 있는 게임만
 * - Steam 상점 API(appdetails, filters=movies)가 준 HLS 주소(hls_h264)와 미리보기 그림만 그대로 씀(만들지 않음)
 * - YouTube와 달리 재생 단추·제목이 없어서 불러오는 대로 바로 보여 줄 수 있음
 * - 한 게임 한 번 물어 메모리에 하루 저장('없음'도 저장). 홈 응답이 늦어지지 않게 기다리는 시간은 짧게, 늦으면 다음 요청부터 붙음
 */
const DETAILS = 'https://store.steampowered.com/api/appdetails';
const DAY = 24 * 60 * 60e3;
const FAIL_RETRY = 10 * 60e3; // 오류면 10분 뒤 다시
const STEAM_VIDEO = /^https:\/\/video\.[a-z.]*steamstatic\.com\//;
const STEAM_IMAGE = /^https:\/\/[a-z.]*steamstatic\.com\//;

/** 게임의 Steam 앱 번호(구매처 주소에서) */
export function steamAppId(game) {
  for (const s of game?.stores ?? []) {
    const m = String(s?.url ?? '').match(/^https?:\/\/store\.steampowered\.com\/app\/(\d+)/i);
    if (m) return m[1];
  }
  return null;
}

// 다른 나라 등급판(독일 USK 등)은 빼고, 출시·공식·전체 트레일러를 먼저
const OTHER_LANG = /\b(?:DE|USK|FR|JP|JA|ES|IT|BR|PT|RU|PL|CN|TW|ZH|TR|AR)\b/;
function score(name) {
  const n = String(name ?? '');
  let s = 0;
  if (/launch/i.test(n)) s += 3;
  if (/official|full trailer/i.test(n)) s += 2;
  if (/trailer/i.test(n)) s += 2;
  if (/gameplay/i.test(n)) s += 1;
  if (/teaser|pre-?order|accolade|demo|interview|dev ?diary/i.test(n)) s -= 2;
  return s;
}

/** Steam 영상 목록에서 하나 고르기 (HLS 주소가 Steam 영상 서버일 때만) */
export function pickMovie(movies) {
  const ok = (movies ?? []).filter((m) => STEAM_VIDEO.test(String(m?.hls_h264 ?? '')));
  if (!ok.length) return null;
  const pool = ok.filter((m) => !OTHER_LANG.test(m.name ?? '')).length ? ok.filter((m) => !OTHER_LANG.test(m.name ?? '')) : ok;
  const best = pool.map((m, i) => ({ m, s: score(m.name) + (m.highlight ? 0.5 : 0), i })).sort((a, b) => b.s - a.s || a.i - b.i)[0].m;
  const poster = STEAM_IMAGE.test(String(best.thumbnail ?? '')) ? best.thumbnail : null;
  return { hls: best.hls_h264, poster, name: best.name ?? null };
}

export function createSteamTrailers({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 6000 } = {}) {
  const cache = new Map(); // appid → { at, ttl, value }
  const pending = new Map(); // appid → Promise

  async function lookup(appid) {
    try {
      const r = await fetchImpl(`${DETAILS}?appids=${encodeURIComponent(appid)}&filters=movies`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`Steam ${r.status}`);
      const j = await r.json();
      const value = j?.[appid]?.success ? pickMovie(j[appid].data?.movies) : null;
      cache.set(appid, { at: now(), ttl: DAY, value });
      return value;
    } catch {
      cache.set(appid, { at: now(), ttl: FAIL_RETRY, value: null });
      return null;
    }
  }

  /** 저장된 값이 있으면 바로, 없으면 물어봄 */
  function get(appid) {
    const hit = cache.get(appid);
    if (hit && now() - hit.at < hit.ttl) return Promise.resolve(hit.value);
    if (!pending.has(appid)) pending.set(appid, lookup(appid).finally(() => pending.delete(appid)));
    return pending.get(appid);
  }

  return {
    get,
    /**
     * 게임마다 `steamTrailer`({ hls, poster })를 붙임. 최대 waitMs만 기다리고, 그 안에 못 받은 게임은 그대로(받는 일은 계속돼 다음에 붙음)
     */
    async attach(games, { waitMs = 2500 } = {}) {
      const ids = games.map(steamAppId);
      const jobs = ids.map((id) => (id ? get(id) : Promise.resolve(null)));
      let timer;
      const late = new Promise((r) => (timer = setTimeout(() => r('late'), waitMs)));
      await Promise.race([Promise.allSettled(jobs), late]);
      clearTimeout(timer);
      return games.map((g, i) => {
        const value = ids[i] ? cache.get(ids[i])?.value : null;
        return value ? { ...g, steamTrailer: { hls: value.hls, poster: value.poster } } : g;
      });
    },
  };
}
