// '나만의 게임 찾기' 조건 설정 창 열기/닫기 상태
import { createContext, useCallback, useContext, useState } from 'react';

const FinderCtx = createContext(null);

export function FinderProvider({ children }) {
  const [state, setState] = useState({ open: false, initial: null });
  const openFinder = useCallback((initial = null) => setState({ open: true, initial }), []);
  const closeFinder = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return <FinderCtx.Provider value={{ ...state, openFinder, closeFinder }}>{children}</FinderCtx.Provider>;
}

export const useFinder = () => useContext(FinderCtx);
