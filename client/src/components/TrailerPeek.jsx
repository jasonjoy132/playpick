import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from '../lib/router.jsx';

/**
 * 트레일러 미리보기 팝업 (홈): 마우스를 게임 위에 OPEN_DELAY 동안 올려 두면 그 자리 위에 작은 창이 떠서
 * IGDB 트레일러(YouTube)를 소리 없이 재생. 마우스가 게임·창 밖으로 나가면 닫힘.
 * - 마우스 기기에서만(터치는 누르면 바로 상세로 가므로 없음). 키보드·터치는 상세 화면 트레일러로
 * - 트레일러가 없는 게임(게관위 전용 등)은 아무 일도 없음
 * - 스크롤·화면 크기 바꿈·Esc·다른 화면 이동이면 닫힘
 */
const OPEN_DELAY = 1200; // ms
const CLOSE_GRACE = 200; // 게임 → 창으로 옮겨 가는 사이 닫히지 않게
const WIDTH = 520;
const BAR = 64; // 창 아래 제목 줄 높이
const HEADER = 72; // 위쪽 고정 헤더만큼 비움

const Ctx = createContext(null);
const canHover = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** 창 위치: 게임 가운데에 맞추되 화면 밖으로 나가지 않게 */
function placeOver(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(WIDTH, vw - 32);
  const h = (w * 9) / 16 + BAR;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  return {
    width: w,
    left: clamp(rect.left + rect.width / 2 - w / 2, 16, vw - w - 16),
    top: clamp(rect.top + rect.height / 2 - h / 2, HEADER, Math.max(HEADER, vh - h - 16)),
  };
}

export function TrailerPeekProvider({ children }) {
  const [peek, setPeek] = useState(null); // { game, pos }
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const { pathname } = useLocation();

  const close = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    setPeek(null);
  }, []);
  const holdOpen = useCallback(() => clearTimeout(closeTimer.current), []);
  const closeSoon = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPeek(null), CLOSE_GRACE);
  }, []);
  const openLater = useCallback((game, el) => {
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      if (!el.isConnected || !el.matches(':hover')) return;
      setPeek({ game, pos: placeOver(el.getBoundingClientRect()) });
    }, OPEN_DELAY);
  }, []);

  useEffect(() => close, [close]);
  useEffect(() => close(), [pathname, close]);
  useEffect(() => {
    if (!peek) return undefined;
    const esc = (e) => e.key === 'Escape' && close();
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', esc);
    };
  }, [peek, close]);

  return (
    <Ctx.Provider value={{ openLater, closeSoon, peekId: peek?.game.id }}>
      {children}
      {peek && createPortal(<PeekWindow game={peek.game} pos={peek.pos} onEnter={holdOpen} onLeave={closeSoon} />, document.body)}
    </Ctx.Provider>
  );
}

/** 게임 요소에 붙일 마우스 처리를 만드는 함수 `peek(game)`. 트레일러가 없거나 Provider 밖이면 빈 객체 */
export function usePeek() {
  const ctx = useContext(Ctx);
  return (game) => {
    if (!ctx || !game?.trailer?.youtubeId) return {};
    return {
      onMouseEnter: (e) => canHover() && ctx.openLater(game, e.currentTarget),
      onMouseLeave: () => ctx.closeSoon(),
      'data-peek': ctx.peekId === game.id ? 'open' : undefined,
    };
  };
}

function PeekWindow({ game, pos, onEnter, onLeave }) {
  const frame = useRef(null);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const id = encodeURIComponent(game.trailer.youtubeId);
  const origin = typeof location !== 'undefined' ? encodeURIComponent(location.origin) : '';
  // 소리 없이 자동 재생(브라우저가 소리 있는 자동 재생은 막음), 반복, 조작 줄 숨김. 소리는 아래 단추로
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&loop=1&playlist=${id}&enablejsapi=1&origin=${origin}`;
  const toggleSound = () => {
    const next = !muted;
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: next ? 'mute' : 'unMute', args: [] }), 'https://www.youtube-nocookie.com');
    setMuted(next);
  };
  return (
    <div
      className="peek"
      role="dialog"
      aria-label={`${game.title} 트레일러 미리보기`}
      style={{ left: pos.left, top: pos.top, width: pos.width }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      data-testid="trailer-peek"
    >
      <div className="peek-video" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` }}>
        <iframe
          ref={frame}
          src={src}
          title={`${game.title} 트레일러`}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setReady(true)}
          className={ready ? 'is-ready' : ''}
          tabIndex={-1}
          data-testid="trailer-peek-iframe"
        />
      </div>
      <div className="peek-bar">
        <b className="peek-title">{game.title}</b>
        <button type="button" className="peek-sound" onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? '소리 켜기' : '소리 끄기'}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" />
            {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
          </svg>
        </button>
        <Link to={`/games/${encodeURIComponent(game.id)}`} className="btn btn-primary btn-sm peek-go">
          상세 보기
        </Link>
      </div>
    </div>
  );
}
