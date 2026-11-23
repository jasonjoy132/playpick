// 익명 이용 기록(성과 분석, server/services/metrics.js). 무작위 방문자 키만 보내고, 실패해도 화면엔 영향 없음
const VID_KEY = 'pp_vid';
let memoryVid = null;

function randomId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

/** 브라우저마다 무작위 키 (저장소를 못 쓰면 이 페이지 동안만) */
export function visitorId() {
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v || !/^[a-z0-9]{8,40}$/.test(v)) {
      v = randomId();
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return (memoryVid ??= randomId());
  }
}

export function track(kind, data = {}) {
  try {
    fetch('/api/events', {
      method: 'POST',
      keepalive: true, // 구매처로 나가도 끝까지 보냄 (sendBeacon 은 X-Requested-With 헤더를 못 붙임)
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'playpick' },
      body: JSON.stringify({ kind, vid: visitorId(), ...data }),
    }).catch(() => {});
  } catch {
    /* 기록 실패는 무시 */
  }
}

/** 하루 한 번 방문 기록 (같은 날 중복은 서버도 거름) */
export function trackVisit() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  try {
    if (localStorage.getItem('pp_visit_day') === today) return;
    localStorage.setItem('pp_visit_day', today);
  } catch {
    /* 저장 못 하면 서버가 거름 */
  }
  track('visit');
}

/** 상세로 들어온 곳: 바로 앞 화면 주소로 판단 */
export function detailFrom(prevPath) {
  if (!prevPath) return 'other';
  const p = prevPath.split('?')[0];
  if (p === '/results') return 'results';
  if (p === '/search') return 'search';
  if (p === '/popular' || p === '/ranking') return 'popular';
  if (p === '/') return 'home';
  if (p === '/for-you') return 'for-you';
  if (p.startsWith('/genre')) return 'genre';
  if (p === '/new' || p.startsWith('/upcoming')) return 'new';
  if (p.startsWith('/mypage') || p === '/wishlist') return 'mypage';
  return 'other';
}
