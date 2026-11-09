// 뒤로 가기 했을 때 목록 화면을 떠나기 전 그대로 보여 주기 위한 기억 장소
//  - 브라우저 기록 항목마다 고유 키(history.state.ppKey)를 붙이고, 그 키 아래에 불러온 목록·'더 보기' 상태·스크롤 위치를 저장
//  - 메모리에만 둠(새로고침하면 처음부터). 최근 기록 항목 MAX_ENTRIES개만 유지
import { useCallback, useState } from 'react';

const MAX_ENTRIES = 30;
const store = new Map(); // ppKey -> Map(name -> value)

export const newKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 지금 기록 항목의 키 (없으면 붙임) */
export function entryKey() {
  if (typeof window === 'undefined') return null;
  let key = window.history.state?.ppKey;
  if (!key) {
    key = newKey();
    window.history.replaceState({ ...(window.history.state ?? {}), ppKey: key }, '');
  }
  return key;
}

export function remember(name, value, key = entryKey()) {
  if (!key) return;
  let m = store.get(key);
  if (!m) {
    m = new Map();
    store.set(key, m);
    while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value); // 오래된 항목부터 버림
  }
  m.set(name, value);
}

export function recall(name, key = entryKey()) {
  return key ? store.get(key)?.get(name) : undefined;
}

/** useState와 같지만 값이 지금 기록 항목에 저장돼, 뒤로 가기로 돌아오면 그 값으로 시작 */
export function usePageState(name, init) {
  const [value, setValue] = useState(() => {
    const saved = recall(name);
    return saved !== undefined ? saved : typeof init === 'function' ? init() : init;
  });
  const set = useCallback(
    (update) =>
      setValue((prev) => {
        const next = typeof update === 'function' ? update(prev) : update;
        remember(name, next);
        return next;
      }),
    [name],
  );
  return [value, set];
}
