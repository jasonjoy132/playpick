import { useCallback, useEffect, useState } from 'react';

/** 비동기 데이터 로딩 상태: loading | error | success */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null, error: null });
    fn().then(
      (data) => alive && setState({ status: 'success', data, error: null }),
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
