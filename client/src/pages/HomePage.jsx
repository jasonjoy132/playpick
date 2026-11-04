import { useRef } from 'react';
import { Link } from '../lib/router.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useFinder } from '../lib/finder.jsx';
import { Carousel } from '../components/Carousel.jsx';
import { GameTile } from '../components/GameTile.jsx';
import { ErrorState, Loading, Warnings } from '../components/Status.jsx';
import { LoginPanel, ProfilePanel } from '../components/LoginPanel.jsx';
import { useAuth } from '../lib/auth.jsx';

function Row({ title, games, options }) {
  const ref = useRef(null);
  const scroll = (d) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="row" aria-labelledby="row-popular">
      <header className="row-head">
        <h2 id="row-popular">{title}</h2>
        <Link to="/popular" className="row-more">
          더 보기 →
        </Link>
        <div className="row-nav">
          <button type="button" className="icon-btn" onClick={() => scroll(-1)} aria-label="왼쪽으로">
            ‹
          </button>
          <button type="button" className="icon-btn" onClick={() => scroll(1)} aria-label="오른쪽으로">
            ›
          </button>
        </div>
      </header>
      <div className="row-grid" ref={ref}>
        {games.map((g) => (
          <GameTile key={g.id} game={g} options={options} />
        ))}
      </div>
    </section>
  );
}

export function HomePage({ options }) {
  const { status, data, error, retry } = useAsync(() => api.featured(), []);
  const { openFinder } = useFinder();
  const { user, ready } = useAuth();

  if (status === 'loading') return <Loading message="추천 게임을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;

  const { games, slideCount, warnings } = data;
  const slides = games.slice(0, slideCount);
  const rest = games.slice(slideCount);

  return (
    <div className="home">
      <Warnings warnings={warnings} />
      <div className="home-grid">
        <div className="home-main">
          <Carousel games={slides} options={options} />
          <section className="finder-cta">
            <div>
              <h2>누구와, 어디서, 어떤 게임을 할까요?</h2>
              <p className="muted">함께할 인원·플랫폼·장르를 고르면 딱 맞는 게임을 찾아 드려요.</p>
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => openFinder()}>
              나만의 게임 찾기
            </button>
          </section>
        </div>
        <aside className="home-side" aria-label="계정">
          {ready && (user ? <ProfilePanel /> : <LoginPanel />)}
        </aside>
      </div>
      {rest.length > 0 && <Row title="인기 게임" games={rest} options={options} />}
    </div>
  );
}
