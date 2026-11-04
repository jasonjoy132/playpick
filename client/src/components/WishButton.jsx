import { useState } from 'react';
import { navigate, useLocation } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';

/** 찜(하트) 버튼. 로그인 안 했으면 로그인 화면으로 */
export function WishButton({ game, variant = 'overlay' }) {
  const { user, isWished, toggleWish } = useAuth();
  const { pathname, search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!game?.id) return null;
  const on = user ? isWished(game) : false;
  const click = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return navigate(`/login?next=${encodeURIComponent(pathname + search)}`);
    setBusy(true);
    setError(null);
    try {
      await toggleWish(game);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`wish wish-${variant}${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? `${game.title} 찜 해제` : `${game.title} 찜하기`}
      title={error || (user ? (on ? '찜 해제' : '찜하기') : '로그인하고 찜하기')}
      onClick={click}
      disabled={busy}
      data-testid="wish-button"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.4 1.1 4.2 2.3h2C13.8 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z" />
      </svg>
      {variant === 'label' && <span>{on ? '찜 해제' : '찜하기'}</span>}
    </button>
  );
}
