// 성과 분석(원페이저 '성과 확인 방법'): 익명 이용 기록 → 관리자 '성과' 탭 숫자
//  - 저장: 브라우저마다 무작위 방문자 키(vid)·한국 날짜·종류·게임 id·스토어 이름·작은 meta 만. IP·회원 정보 없음
//  - 원본 기록은 90일 뒤 지움(관리자가 성과를 볼 때 함께 정리)
//
// 지표 정의 (보고서에 그대로 씀)
//  - 추천 게임 클릭률   = 추천 목록을 본 방문자 중, 추천 목록에서 게임 상세로 들어간 방문자 비율
//  - 구매처 이동 비율   = 게임 상세를 본 (방문자·게임) 중, 그 게임의 구매처 링크를 누른 비율
//  - 추천 만족도       = 추천 목록 아래 '도움 됐어요/별로예요' 응답 중 '도움 됐어요' 비율(응답 수 함께)
//  - 재방문율          = 기간 안에 온 방문자 중, 기간 안의 서로 다른 날에 2번 이상 온 방문자 비율
//  - 단계별 남은 비율   = 방문자 → 추천 목록 → 추천에서 상세 → 그 뒤 구매처
//  - 결과 0개 비율      = 추천 목록 요청 중 '모든 조건 일치'가 0개였던 비율(데이터를 보강할 조건)
import { kstDay } from '../community/contributors.js';

export const EVENT_KINDS = ['visit', 'results', 'detail', 'store_click', 'feedback'];
export const DETAIL_FROM = ['results', 'search', 'popular', 'home', 'for-you', 'genre', 'new', 'mypage', 'other'];
const KEEP_DAYS = 90;
const DAY = 86400e3;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|lighthouse|preview/i;

export function isBot(ua) {
  return !ua || BOT_UA.test(String(ua));
}

/** 받은 값 확인 → 저장할 행(아니면 null) */
export function cleanEvent(body = {}) {
  const kind = String(body.kind || '');
  const vid = String(body.vid || '');
  if (!EVENT_KINDS.includes(kind) || !/^[a-z0-9]{8,40}$/i.test(vid)) return null;
  const gameId = body.gameId == null ? null : String(body.gameId).slice(0, 80);
  let store = null;
  let meta = null;
  if (kind === 'results') meta = { zero: body.zero === true, q: String(body.q || '').slice(0, 300) };
  if (kind === 'detail') {
    if (!gameId) return null;
    meta = { from: DETAIL_FROM.includes(body.from) ? body.from : 'other' };
  }
  if (kind === 'store_click') {
    if (!gameId || !body.store) return null;
    store = String(body.store).slice(0, 40);
  }
  if (kind === 'feedback') {
    if (body.value !== 'up' && body.value !== 'down') return null;
    meta = { value: body.value, q: String(body.q || '').slice(0, 300) };
  }
  return { kind, vid, gameId, store, meta };
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** 기간 하나의 숫자 (rows: 그 기간 기록) */
export function computeMetrics(rows) {
  const by = (k) => rows.filter((r) => r.kind === k);
  const vids = new Set(rows.map((r) => r.vid));
  const resultsRows = by('results');
  const detailRows = by('detail');
  const clickRows = by('store_click');
  const fbRows = by('feedback');
  const sawResults = new Set(resultsRows.map((r) => r.vid));
  const fromResults = new Set(detailRows.filter((r) => r.meta?.from === 'results' && sawResults.has(r.vid)).map((r) => r.vid));
  const clickedVids = new Set(clickRows.map((r) => r.vid));
  const boughtAfterRec = [...fromResults].filter((v) => clickedVids.has(v)).length;
  // 구매처 이동: (방문자, 게임) 쌍 기준
  const pair = (r) => `${r.vid}|${r.gameId}`;
  const viewed = new Set(detailRows.map(pair));
  const clicked = new Set(clickRows.map(pair).filter((p) => viewed.has(p)));
  // 재방문: 서로 다른 날 2번 이상
  const days = new Map();
  for (const r of rows) (days.get(r.vid) ?? days.set(r.vid, new Set()).get(r.vid)).add(r.day);
  const returning = [...days.values()].filter((s) => s.size >= 2).length;
  const up = fbRows.filter((r) => r.meta?.value === 'up').length;
  const zero = resultsRows.filter((r) => r.meta?.zero).length;
  const count = (list, key) =>
    [...list.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map())].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return {
    visitors: vids.size,
    recClickRate: pct(fromResults.size, sawResults.size),
    storeRate: pct(clicked.size, viewed.size),
    satisfaction: pct(up, fbRows.length),
    feedbackCount: fbRows.length,
    returnRate: pct(returning, vids.size),
    zeroRate: pct(zero, resultsRows.length),
    resultsCount: resultsRows.length,
    funnel: [
      { key: 'visit', label: '방문', n: vids.size },
      { key: 'results', label: '추천 목록', n: sawResults.size },
      { key: 'detail', label: '추천에서 상세', n: fromResults.size },
      { key: 'store', label: '구매처 이동', n: boughtAfterRec },
    ],
    stores: count(clickRows, (r) => r.store),
    detailFrom: count(detailRows, (r) => r.meta?.from ?? 'other'),
  };
}

export function createMetrics(db, { now = () => Date.now() } = {}) {
  const parse = (r) => ({ ...r, gameId: r.game_id, meta: r.meta ? JSON.parse(r.meta) : null });
  return {
    /** 기록 하나 저장 (같은 날 visit·같은 조건 만족도는 한 번만) */
    async record(ev) {
      const t = now();
      const day = kstDay(t);
      if (ev.kind === 'visit' && (await db.prepare("SELECT 1 FROM events WHERE vid = ? AND day = ? AND kind = 'visit'").get(ev.vid, day))) return false;
      if (ev.kind === 'feedback') {
        const prev = await db.prepare("SELECT meta FROM events WHERE vid = ? AND kind = 'feedback'").all(ev.vid);
        if (prev.some((r) => JSON.parse(r.meta || '{}').q === ev.meta.q)) return false;
      }
      await db
        .prepare('INSERT INTO events (vid, day, kind, game_id, store, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ev.vid, day, ev.kind, ev.gameId, ev.store, ev.meta ? JSON.stringify(ev.meta) : null, new Date(t).toISOString());
      return true;
    },
    /** 최근 days일과 그 앞 days일 비교 */
    async summary(days = 7) {
      const n = days === 30 ? 30 : 7;
      const t = now();
      await db.prepare('DELETE FROM events WHERE day < ?').run(kstDay(t - KEEP_DAYS * DAY));
      const to = kstDay(t);
      const from = kstDay(t - (n - 1) * DAY);
      const prevTo = kstDay(t - n * DAY);
      const prevFrom = kstDay(t - (2 * n - 1) * DAY);
      const rows = (await db.prepare('SELECT vid, day, kind, game_id, store, meta FROM events WHERE day >= ? AND day <= ?').all(prevFrom, to)).map(parse);
      const cur = rows.filter((r) => r.day >= from);
      const prev = rows.filter((r) => r.day <= prevTo);
      return { days: n, range: { from, to }, prevRange: { from: prevFrom, to: prevTo }, current: computeMetrics(cur), previous: computeMetrics(prev) };
    },
  };
}
