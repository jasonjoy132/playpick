// 의존성 없는 간단한 히스토리 라우터
//  - 기록 항목마다 키(ppKey)를 붙여, 뒤로·앞으로 가기 때 떠나기 전 스크롤 위치로 되돌림(목록 데이터는 pageMemory에서)
import { createContext, useContext, useEffect, useState } from 'react';
import { entryKey, newKey, recall, remember } from './pageMemory.js';

const RouterCtx = createContext(null);
const SCROLL = '__scroll';
let restoring = false; // 스크롤을 되돌리는 동안에는 위치를 저장하지 않음

export function navigate(to, { replace = false } = {}) {
  remember(SCROLL, window.scrollY); // 떠나는 화면의 위치
  // from: 어느 화면에서 왔는지(상세의 '목록으로'가 새로 열지 않고 뒤로 가기로 돌아가게)
  const state = { ppKey: newKey(), from: replace ? window.history.state?.from : window.location.pathname + window.location.search };
  if (replace) window.history.replaceState(state, '', to);
  else window.history.pushState(state, '', to);
  window.dispatchEvent(new Event('playpick:navigate'));
  window.scrollTo(0, 0);
}

/** 저장해 둔 위치로 스크롤. 목록이 다 그려질 때까지(최대 3초) 16ms마다 다시 시도(rAF는 숨은 탭에서 멈춰서 타이머 사용), 사용자가 직접 스크롤하면 멈춤 */
function restoreScroll(y) {
  restoring = true;
  const started = performance.now();
  let cancelled = false;
  const cancel = () => (cancelled = true);
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  events.forEach((e) => window.addEventListener(e, cancel, { passive: true }));
  const done = () => {
    restoring = false;
    events.forEach((e) => window.removeEventListener(e, cancel));
  };
  const tick = () => {
    if (cancelled) return done();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.min(y, Math.max(0, max)));
    if (max >= y || performance.now() - started > 3000) return done();
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
}

const read = () => ({ pathname: window.location.pathname, search: window.location.search, key: entryKey() });

export function Router({ children }) {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    let timer = null;
    const onScroll = () => {
      if (restoring) return;
      clearTimeout(timer);
      timer = setTimeout(() => !restoring && remember(SCROLL, window.scrollY), 100);
    };
    const onNavigate = () => setLoc(read());
    const onPop = () => {
      clearTimeout(timer);
      restoring = true;
      setLoc(read());
      restoreScroll(recall(SCROLL) ?? 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPop);
    window.addEventListener('playpick:navigate', onNavigate);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('playpick:navigate', onNavigate);
    };
  }, []);
  return <RouterCtx.Provider value={loc}>{children}</RouterCtx.Provider>;
}

export const useLocation = () => useContext(RouterCtx);

/** 바로 앞 화면이 to면 뒤로 가기(떠나기 전 목록·스크롤 그대로), 아니면 새로 이동 */
export function goBackTo(to) {
  if (window.history.state?.from === to) window.history.back();
  else navigate(to);
}

export function Link({ to, children, ...rest }) {
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

/** '/games/:id' 형태 패턴 매칭 */
export function matchPath(pattern, pathname) {
  const pp = pattern.split('/').filter(Boolean);
  const ap = pathname.split('/').filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (pp[i] !== ap[i]) return null;
  }
  return params;
}
