// '나만의 게임 찾기' 조건 설정 창 열기/닫기 상태
//  - 열 때 기록을 하나 쌓아(주소는 그대로) 휴대폰 '뒤로 가기'가 사이트를 떠나지 않고 창만 닫게 함
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const FinderCtx = createContext(null);
const onTop = () => Boolean(window.history.state?.ppFinder);

export function FinderProvider({ children }) {
  const [state, setState] = useState({ open: false, initial: null });
  const openFinder = useCallback((initial = null) => {
    if (!onTop()) {
      const here = window.location.pathname + window.location.search;
      // ppKey는 그대로 두어 이 화면의 목록·스크롤 기억을 같이 씀
      window.history.pushState({ ...window.history.state, ppFinder: true, from: here }, '', window.location.href);
    }
    setState({ open: true, initial });
  }, []);
  /** keepHistory: 바로 다른 화면으로 이동할 때(쌓은 기록은 이동이 replace로 덮음) */
  const closeFinder = useCallback(({ keepHistory = false } = {}) => {
    setState((s) => ({ ...s, open: false }));
    if (!keepHistory && onTop()) window.history.back();
  }, []);
  useEffect(() => {
    const onPop = () => {
      if (!onTop()) setState((s) => (s.open ? { ...s, open: false } : s));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return <FinderCtx.Provider value={{ ...state, openFinder, closeFinder }}>{children}</FinderCtx.Provider>;
}

export const useFinder = () => useContext(FinderCtx);
