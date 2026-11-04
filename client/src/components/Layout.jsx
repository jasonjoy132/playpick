import { useEffect, useRef, useState } from 'react';
import { Link, navigate, useLocation } from '../lib/router.jsx';
import { useFinder } from '../lib/finder.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from './Logo.jsx';
import { Avatar } from './Avatar.jsx';
import { NameBadge } from './Badge.jsx';

const NAV = [
  ['/', '홈'],
  ['/popular', '인기 게임'],
  ['/new', '신작·출시 예정'],
  ['/ranking', '평점 랭킹'],
  ['/genres', '장르별 게임'],
];

function SearchBox() {
  const { pathname, search } = useLocation();
  const current = pathname === '/search' ? new URLSearchParams(search).get('q') || '' : '';
  const [q, setQ] = useState(current);
  useEffect(() => setQ(current), [current]);
  const submit = (e) => {
    e.preventDefault();
    const t = q.trim();
    if (t) navigate(`/search?q=${encodeURIComponent(t)}`);
  };
  return (
    <form className="searchbox" role="search" onSubmit={submit}>
      <span className="searchbox-icon" aria-hidden="true">
        ⌕
      </span>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="게임 검색" aria-label="게임명 검색" maxLength={50} />
    </form>
  );
}

export function Layout({ meta, children }) {
  const { openFinder } = useFinder();
  const { pathname } = useLocation();
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="site-header">
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
          <SearchBox />
          <button type="button" className="btn btn-gold header-cta" onClick={() => openFinder()} data-testid="open-finder">
            나만의 게임 찾기
          </button>
          <UserMenu />
        </div>
      </header>
      {meta?.isDemo && <DemoBanner />}
      <main id="main" className="container main">
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
