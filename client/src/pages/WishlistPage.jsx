import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { Cover } from '../components/Cover.jsx';
import { RatingBadge } from '../components/Stars.jsx';
import { ErrorState, Loading } from '../components/Status.jsx';

export function WishlistPage({ options }) {
  const { user, ready, refreshWishCount } = useAuth();
  const { status, data, error, retry } = useAsync(() => (user ? api.wishlist() : Promise.resolve(null)), [user?.id]);
  const [removed, setRemoved] = useState(new Set());

  if (!ready) return <Loading />;
  if (!user) {
    return (
      <div className="state">
        <h1>로그인이 필요해요</h1>
        <p className="muted">찜 목록은 로그인한 뒤 볼 수 있어요.</p>
        <Link to="/login?next=%2Fwishlist" className="btn btn-gold">
          로그인
        </Link>
      </div>
    );
  }
  if (status === 'loading') return <Loading message="찜 목록을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;

  const items = data.items.filter((i) => !removed.has(i.gameId));
  const remove = async (id) => {
    await api.unwish(id);
    setRemoved((s) => new Set([...s, id]));
    refreshWishCount();
  };
  const label = (v) => options?.platforms.find((o) => o.value === v)?.label || v;

  return (
    <>
      <section className="page-head">
        <h1>내 찜 목록</h1>
        <p className="muted">{items.length}개 게임</p>
      </section>
      {items.length === 0 ? (
        <div className="state" data-testid="wishlist-empty">
          <h2>아직 찜한 게임이 없어요</h2>
          <p className="muted">게임 카드나 상세 화면의 ♡ 버튼을 눌러 찜해 보세요.</p>
          <Link to="/" className="btn btn-primary">
            게임 둘러보기
          </Link>
        </div>
      ) : (
        <div className="card-grid" data-testid="wishlist">
          {items.map((w) => (
            <article key={w.gameId} className="tile" data-testid="game-card">
              <div className="tile-cover">
                <Cover game={{ id: w.gameId, title: w.title, imageUrl: w.imageUrl }} />
                <div className="tile-badges">
                  {w.platforms?.slice(0, 2).map((p) => (
                    <span key={p} className="pill pill-dark">
                      {label(p)}
                    </span>
                  ))}
                  {w.isDemo && <span className="pill pill-demo">데모</span>}
                </div>
              </div>
              <div className="tile-body">
                <h3 className="tile-title">
                  <Link to={`/games/${encodeURIComponent(w.gameId)}`} className="stretched-link">
                    {w.title}
                  </Link>
                </h3>
                <RatingBadge rating={w.userRating} />
                <button type="button" className="btn btn-ghost btn-sm tile-action" onClick={() => remove(w.gameId)}>
                  찜 해제
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
