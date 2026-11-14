import { useEffect, useRef, useState } from 'react';
import { Link, navigate, useLocation } from '../lib/router.jsx';
import { useFinder } from '../lib/finder.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from './Logo.jsx';
import { Avatar } from './Avatar.jsx';
import { NameBadge } from './Badge.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { addRecent, clearRecent, readRecent, removeRecent } from '../lib/recentSearch.js';

const NAV = [
  ['/', '홈'],
  ['/popular', '인기 게임'],
  ['/new', '신작·출시 예정'],
  ['/hall-of-fame', '명예의 전당'],
  ['/genres', '장르별 게임'],
];

/** 좁은 화면: 아래로 내리면 헤더를 숨기고, 위로 올리면 다시 보여 줌 */
function useTuckOnScroll(enabled) {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setTucked(false);
      return undefined;
    }
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 120) setTucked(false);
        else if (y > last + 6) setTucked(true);
        else if (y < last - 6) setTucked(false);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return tucked;
}

function SearchBox({ open: visible = true, onClose }) {
  const { pathname, search } = useLocation();
  const current = pathname === '/search' ? new URLSearchParams(search).get('q') || '' : '';
  const [q, setQ] = useState(current);
  const [recent, setRecent] = useState(readRecent);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  useEffect(() => setQ(current), [current]);
  // 검색 결과 화면으로 바로 들어와도(주소 입력·링크) 최근 검색어에 기록
  useEffect(() => {
    if (current.trim()) setRecent(addRecent(current));
  }, [current]);
  const t = q.trim().toLowerCase();
  const shown = t ? recent.filter((x) => x.toLowerCase().includes(t) && x.toLowerCase() !== t) : recent;
  const isOpen = open && shown.length > 0;
  const go = (text) => {
    const v = text.trim();
    if (!v) return;
    setRecent(addRecent(v));
    setQ(v);
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
    navigate(`/search?q=${encodeURIComponent(v)}`);
  };
  const submit = (e) => {
    e.preventDefault();
    go(isOpen && active >= 0 ? shown[active] : q);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (isOpen) e.preventDefault(); // 검색창 기본 동작(입력 지우기) 대신 목록만 닫기
      else onClose?.();
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!isOpen) return setOpen(true);
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      // -1(입력창) → 0 … n-1 → -1 로 돌기
      setActive((i) => ((i + 1 + d + shown.length + 1) % (shown.length + 1)) - 1);
    }
  };
  const remove = (x) => {
    const next = removeRecent(x);
    setRecent(next);
    setActive(-1);
    inputRef.current?.focus();
  };
  return (
    <form
      className={`searchbox${visible ? ' is-open' : ''}`}
      id="site-search"
      role="search"
      onSubmit={submit}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <span className="searchbox-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="게임 검색"
        aria-label="게임명 검색"
        maxLength={50}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls="search-recent-list"
        aria-autocomplete="list"
        aria-activedescendant={isOpen && active >= 0 && active < shown.length ? `search-recent-${active}` : undefined}
      />
      {isOpen && (
        <div className="search-recent" data-testid="search-recent" onMouseDown={(e) => e.preventDefault()} /* 누르는 동안 입력창 포커스 유지 */>
          <div className="search-recent-head">
            <span>최근 검색어</span>
            <button
              type="button"
              className="link-btn"
              data-testid="search-recent-clear"
              onClick={() => {
                setRecent(clearRecent());
                setOpen(false);
                inputRef.current?.focus();
              }}
            >
              전체 삭제
            </button>
          </div>
          <ul id="search-recent-list" role="listbox" aria-label="최근 검색어">
            {shown.map((x, i) => (
              <li key={x} id={`search-recent-${i}`} role="option" aria-selected={i === active} className={`search-recent-item${i === active ? ' is-active' : ''}`} data-testid="search-recent-item">
                <button type="button" className="search-recent-go" tabIndex={-1} onClick={() => go(x)} onMouseEnter={() => setActive(i)}>
                  <span aria-hidden="true">🕘</span>
                  <span className="search-recent-text">{x}</span>
                </button>
                <button type="button" className="search-recent-remove" tabIndex={-1} aria-label={`‘${x}’ 지우기`} data-testid="search-recent-remove" onClick={() => remove(x)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

/** 회원 탈퇴 직후 한 번 보이는 안내 (마이페이지가 sessionStorage에 표시를 남김) */
function ByeNotice() {
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  // Layout은 화면을 옮겨도 그대로라서 주소가 바뀔 때마다 확인
  useEffect(() => {
    try {
      if (sessionStorage.getItem('pp-bye')) {
        sessionStorage.removeItem('pp-bye');
        setShow(true);
      } else setShow(false); // 다른 화면으로 가면 닫힘
    } catch {
      /* 저장소를 못 쓰면 안내 없이 */
    }
  }, [pathname]);
  if (!show) return null;
  return (
    <div className="bye-notice" role="status" data-testid="bye-notice">
      <p>
        <b>탈퇴했어요.</b> 그동안 플레이픽을 이용해 주셔서 고마워요. 계정과 찜·리뷰·알림을 모두 지웠어요.
      </p>
      <button type="button" className="link-btn" onClick={() => setShow(false)} aria-label="안내 닫기">
        닫기
      </button>
    </div>
  );
}

export function Layout({ meta, children }) {
  const { openFinder } = useFinder();
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(pathname === '/search');
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 860px)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return undefined;
    const mq = matchMedia('(max-width: 860px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => setSearchOpen(pathname === '/search'), [pathname]);
  const tucked = useTuckOnScroll(narrow && !searchOpen);
  // 좁은 화면에서 메뉴가 옆으로 넘치면 지금 화면 메뉴가 보이게 가로로만 옮김
  useEffect(() => {
    const nav = document.querySelector('.site-header .nav');
    const on = nav?.querySelector('a.is-active');
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return;
    const left = on.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    nav.scrollLeft = left - (nav.clientWidth - on.offsetWidth) / 2;
  }, [pathname, narrow]);
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <header className={`site-header${tucked ? ' is-tucked' : ''}`}>
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="플레이픽 홈">
            <Logo />
          </Link>
          <nav className="nav" aria-label="주 메뉴">
            {NAV.map(([to, label]) => {
              const active = to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
              return (
                <Link key={to} to={to} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <SearchBox open={!narrow || searchOpen} onClose={narrow ? () => setSearchOpen(false) : undefined} />
          <button
            type="button"
            className="search-toggle"
            aria-label={searchOpen ? '검색 닫기' : '게임 검색'}
            aria-expanded={searchOpen}
            aria-controls="site-search"
            onClick={() => {
              const next = !searchOpen;
              setSearchOpen(next);
              if (next) requestAnimationFrame(() => document.querySelector('#site-search input')?.focus());
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              {searchOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>}
            </svg>
          </button>
          <button type="button" className="btn btn-gold header-cta" onClick={() => openFinder()} data-testid="open-finder">
            <span className="cta-long">나만의 </span>게임 찾기
          </button>
          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      {meta?.isDemo && <DemoBanner />}
      <main id="main" className="container main">
        <ByeNotice />
        {children}
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <p className="footer-brand">
            <Logo size={20} /> <span className="muted">© 2026</span>
          </p>
          <p className="muted">
            데이터 출처: {meta ? meta.sources.join(', ') : '확인 중'}
            {meta?.isDemo && ' · 시연용 가상 데이터'}
            {meta && !meta.isDemo && meta.translation && ' · 소개 번역: DeepL'}
          </p>
          <nav className="footer-links" aria-label="사이트 정보">
            <Link to="/terms">이용약관</Link>
            <Link to="/privacy">
              <b>개인정보처리방침</b>
            </Link>
            <Link to="/sources">데이터 출처</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function UserMenu() {
  const { user, ready, logout } = useAuth();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!ready) return <span className="avatar avatar-ghost" aria-hidden="true" />;
  if (!user) {
    const next = pathname === '/login' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return (
      <Link to={`/login${next}`} className="avatar avatar-ghost" aria-label="로그인" data-testid="header-login">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v1.5h16V19c0-2.8-3.6-5-8-5z" /></svg>
      </Link>
    );
  }
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="avatar-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="user-menu">
        <Avatar user={user} />
        <span className="sr-only">{user.nickname}님 메뉴</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-name">
            <NameBadge badge={user.badge} />
            {user.nickname}님
          </p>
          <Link to="/mypage/profile" role="menuitem">
            마이페이지
          </Link>
          <Link to="/mypage/wishlist" role="menuitem">
            찜 목록
          </Link>
          <Link to="/mypage/reviews" role="menuitem">
            내 리뷰
          </Link>
          <Link to="/mypage/recent" role="menuitem">
            최근 본 게임
          </Link>
          <Link to="/submit" role="menuitem" data-testid="menu-submit">
            게임 제보
          </Link>
          {user.isAdmin && (
            <Link to="/admin" role="menuitem" data-testid="menu-admin">
              제보 관리 (관리자)
            </Link>
          )}
          <button type="button" role="menuitem" onClick={logout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note" data-testid="demo-banner">
      <div className="container">
        <strong>데모 모드</strong> 실제 API가 연결되지 않아 <b>가상의 데모 게임</b>으로 동작합니다. 게임명·업체·구매처는 실제가 아닙니다.
      </div>
    </div>
  );
}
