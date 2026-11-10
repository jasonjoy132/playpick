// 헤더 검색창 최근 검색어: 이 브라우저에만 저장(localStorage), 최근 MAX개, 같은 검색어는 맨 위로
const KEY = 'pp-recent-search';
const MAX = 8;

export function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 저장소를 못 쓰면 기록 없이 */
  }
  return readRecent();
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export function addRecent(q) {
  const t = String(q ?? '').trim().slice(0, 50);
  if (!t) return readRecent();
  return write([t, ...readRecent().filter((x) => !same(x, t))]);
}

export const removeRecent = (q) => write(readRecent().filter((x) => !same(x, q)));

export function clearRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
  return [];
}
