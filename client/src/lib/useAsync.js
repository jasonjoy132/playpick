import { useCallback, useEffect, useRef, useState } from 'react';
import { recall, remember } from './pageMemory.js';

/**
 * 비동기 데이터 로딩 상태: loading | error | success
 * memo: 이름을 주면 받은 데이터를 지금 기록 항목에 저장 → 뒤로 가기로 돌아오면 다시 받지 않고 그대로 보여 줌(스크롤 위치 복원용)
 */
export function useAsync(fn, deps, memo = null) {
  const name = memo ? `async:${memo}:${JSON.stringify(deps)}` : null;
  const [state, setState] = useState(() => {
    const saved = name ? recall(name) : undefined;
    return saved !== undefined ? { status: 'success', data: saved, error: null } : { status: 'loading', data: null, error: null };
  });
  const restored = useRef(state.status === 'success');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (restored.current) {
      restored.current = false; // 저장해 둔 데이터로 시작했으면 처음 한 번은 다시 받지 않음
      return undefined;
    }
    let alive = true;
    setState({ status: 'loading', data: null, error: null });
    fn().then(
      (data) => {
        if (!alive) return;
        if (name) remember(name, data);
        setState({ status: 'success', data, error: null });
      },
      (error) => alive && setState({ status: 'error', data: null, error }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}
