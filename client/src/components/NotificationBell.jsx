// 헤더 알림 종: 안 읽은 알림 수 + 누르면 알림 목록 (제보 승인·거절, 리뷰 숨김, 새 칭호 등)
// 실시간 연결 없이 화면을 옮길 때와 창이 보이는 동안 60초마다 숫자만 받음
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Link, navigate, useLocation } from '../lib/router.jsx';

const POLL_MS = 60_000;
const ICON = { ok: '✓', no: '✕', badge: '🏅', wish: '♥', warn: '!', info: '👋' };

export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export function NotificationBell() {
  const { user, ready } = useAuth();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState({ unread: 0, pending: null });
  const [list, setList] = useState(null); // { items, unread, pending } | null(불러오는 중)
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const uid = user?.id;

  const refresh = useCallback(() => {
    if (uid == null) return;
    api.notificationCount().then(setCount, () => {});
  }, [uid]);

  // 화면을 옮길 때마다 + 창이 보이는 동안 60초마다
  useEffect(() => {
    refresh();
  }, [refresh, pathname, search]);
  useEffect(() => {
    if (uid == null) return undefined;
    const tick = () => document.visibilityState === 'visible' && refresh();
    const t = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [uid, refresh]);

  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return undefined;
    // 열려 있는 동안 새 칭호 토스트가 패널을 가리지 않게 잠시 숨김 (같은 내용이 알림에도 있음)
    document.body.classList.add('notif-open');
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.body.classList.remove('notif-open');
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!ready || !user) return null;

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    setList(null);
    setError(null);
    api.notifications().then(
      (r) => {
        setList(r);
        setCount({ unread: r.unread, pending: r.pending });
      },
      (e) => setError(e.message || '알림을 불러오지 못했어요.'),
    );
  };
  const markAll = async () => {
    try {
      const r = await api.readNotifications({ all: true });
      setList((l) => l && { ...l, items: l.items.map((n) => ({ ...n, read: true })), unread: 0 });
      setCount((c) => ({ ...c, unread: r.unread }));
    } catch {
      /* 다음에 다시 */
    }
  };
  const openItem = (n) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    if (!n.read) {
      api.readNotifications({ ids: [n.id] }).then((r) => setCount((c) => ({ ...c, unread: r.unread })), () => {});
      setList((l) => l && { ...l, items: l.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const unread = count.unread;
  const pending = count.pending;
  const label = unread > 0 ? `알림 ${unread}개 안 읽음` : '알림';
  return (
    <div className="notif" ref={ref}>
      <button type="button" className="notif-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={label} title="알림" onClick={toggle} data-testid="notif-bell">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7z" />
        </svg>
        {unread > 0 && (
          <span className="notif-count" data-testid="notif-count">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {!unread && pending > 0 && <span className="notif-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="알림" data-testid="notif-panel">
          <header className="notif-head">
            <h2>알림</h2>
            <button type="button" className="link-btn" onClick={markAll} disabled={!list || !list.items.some((n) => !n.read)} data-testid="notif-read-all">
              모두 읽음
            </button>
          </header>
          {pending > 0 && (
            <Link to="/admin" className="notif-admin" data-testid="notif-pending">
              <span>
                관리자 · 검토 대기 <b>{pending}건</b>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
          <div className="notif-body">
            {error ? (
              <p className="notif-empty">{error}</p>
            ) : !list ? (
              <p className="notif-empty">불러오는 중…</p>
            ) : list.items.length === 0 ? (
              <p className="notif-empty">
                새 알림이 없어요.
                <br />
                <small>제보가 승인·거절되거나 새 칭호를 받으면 여기에 알려 드려요.</small>
              </p>
            ) : (
              <ul className="notif-list">
                {list.items.map((n) => (
                  <li key={n.id}>
                    <a href={n.link || '#'} className={`notif-item${n.read ? '' : ' is-unread'}`} onClick={openItem(n)} data-testid="notif-item">
                      <span className={`notif-icon tone-${n.tone}`} aria-hidden="true">
                        {ICON[n.tone] ?? ICON.info}
                      </span>
                      <span className="notif-text">
                        <b>{n.title}</b>
                        {n.body && <span className="notif-desc">{n.body}</span>}
                        <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                      </span>
                      {!n.read && <span className="notif-unread" aria-label="안 읽음" />}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer className="notif-foot">알림은 최근 30개까지 보여요</footer>
        </div>
      )}
    </div>
  );
}
