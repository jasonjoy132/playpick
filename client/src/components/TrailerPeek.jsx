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

const YT_ORIGIN = 'https://www.youtube-nocookie.com';
// YouTube는 controls=0이어도 재생 시작 뒤 약 3.5초 동안 가운데 멈춤·이전·다음 단추와 제목을 보여 줌(2025 새 플레이어, 끄는 설정 없음)
// → 그동안은 사진 아래에서 몰래 재생하고, 단추가 사라진 뒤에 영상을 보여 줌
const REVEAL_AFTER = 3800;
// 화면에 들어오기 전(위아래 두 화면 거리)부터 미리 불러와 재생 → 스크롤해 도착하면 이미 단추 없이 재생 중
const PRELOAD_MARGIN = '200% 0px';

/** 자동 재생해도 되는 환경인지: 동작 줄이기·데이터 절약이면 영상 대신 사진 */
const motionOk = () =>
  typeof matchMedia !== 'undefined' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !(typeof navigator !== 'undefined' && navigator.connection?.saveData);

/**
 * 배경 트레일러 (홈 첫 화면 큰 그림·인기 1위): 화면 가까이 있는 동안만 소리 없이 반복 재생, 멀어지면 멈춤(iframe 지움).
 * 조작(멈춤·소리) 없이 사진 자리에서 그냥 움직이는 그림처럼 보임
 * 실제로 재생이 시작되고(YouTube가 알려 주는 상태 1) YouTube 단추가 사라진 뒤(REVEAL_AFTER) 사진 위로 영상이 나타남.
 * 화면 가까이 오면 미리 불러 둠(PRELOAD_MARGIN). 제목 줄·로고는 영상을 크게 키워 위아래를 잘라 가림(styles.css .backdrop-video)
 * → 자동 재생이 막히거나(일부 휴대폰) 재생 못 하는 영상이면 YouTube 화면 대신 사진이 그대로 보임
 */
export function BackdropTrailer({ game, testId = 'lead-trailer' }) {
  const box = useRef(null);
  const frame = useRef(null);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);
  const yt = game?.trailer?.youtubeId;
  useEffect(() => {
    const el = box.current;
    if (!el || !yt || !motionOk() || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => {
      setInView(e.isIntersecting);
      if (!e.isIntersecting) setReady(false);
    }, { rootMargin: PRELOAD_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [yt]);
  useEffect(() => {
    if (!inView) return undefined;
    // 플레이어가 준비될 때까지 '듣고 있어요'를 거듭 보냄(처음 한 번은 놓치는 일이 많음) → 답이 오면 멈춤
    const say = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'lead' }), YT_ORIGIN);
    const hello = setInterval(say, 200);
    let timer = 0;
    const onMsg = (e) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow) return;
      clearInterval(hello);
      let d;
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (d?.info?.playerState === 1 && !timer) timer = setTimeout(() => setReady(true), REVEAL_AFTER);
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      clearInterval(hello);
      clearTimeout(timer);
    };
  }, [inView]);
  if (!yt) return null;
  const id = encodeURIComponent(yt);
  const origin = typeof location !== 'undefined' ? encodeURIComponent(location.origin) : '';
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&loop=1&playlist=${id}&disablekb=1&iv_load_policy=3&enablejsapi=1&origin=${origin}`;
  return (
    <div className="backdrop-video" ref={box} aria-hidden="true">
        {inView && (
          <iframe
            ref={frame}
            src={src}
            title={`${game.title} 트레일러`}
            allow="autoplay; encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
            className={ready ? 'is-ready' : ''}
            data-testid={testId}
          />
        )}
    </div>
  );
}
