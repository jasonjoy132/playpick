import { useRef, useState } from 'react';
import { Link, navigate } from '../lib/router.jsx';
import { criteriaToSearch, hasAnyCriteria } from '../lib/criteria.js';
import { ChipGroup } from '../components/FinderModal.jsx';
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

/** 첫 화면 큰 안내: 인원·플랫폼을 바로 고르고 추천 목록으로 (장르까지는 '나만의 게임 찾기' 창) */
function HeroFinder({ options }) {
  const { openFinder } = useFinder();
  const [players, setPlayers] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const criteria = { players, platforms, genres: [] };
  const go = () => (hasAnyCriteria(criteria) ? navigate(`/results?${criteriaToSearch(criteria)}`) : openFinder());
  const short = (o) => ({ ...o, label: o.value === 1 ? '혼자' : o.label });
  return (
    <section className="hero-finder" data-testid="hero-finder" aria-labelledby="hero-title">
      <h1 id="hero-title">
        친구들과 같이 할 게임,
        <br />
        몇 명이서 하나요?
      </h1>
      <p>인원·플랫폼만 고르면 같이 하기 좋은 게임을 찾아 드려요.</p>
      <ChipGroup
        legend={<span className="sr-only">함께할 인원</span>}
        name="hero-players"
        type="radio"
        options={(options?.players ?? []).map(short)}
        isChecked={(v) => players === v}
        onToggle={(v) => setPlayers((p) => (p === v ? null : v))}
      />
      <ChipGroup
        legend={<span className="sr-only">플랫폼</span>}
        name="hero-platforms"
        type="checkbox"
        options={options?.platforms ?? []}
        isChecked={(v) => platforms.includes(v)}
        onToggle={(v) => setPlatforms((l) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]))}
      />
      <div className="hero-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={go} data-testid="hero-go">
          추천 게임 찾기 →
        </button>
        <button type="button" className="link-btn" onClick={() => openFinder(criteria)}>
          장르까지 고르기
        </button>
      </div>
    </section>
  );
}

export function HomePage({ options }) {
  const { status, data, error, retry } = useAsync(() => api.featured(), []);
  const { user, ready } = useAuth();

  if (status === 'loading') return <Loading message="추천 게임을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;

  const { games, slideCount, warnings } = data;
  const slides = games.slice(0, slideCount);
  const rest = games.slice(slideCount);

  return (
    <div className="home">
      <Warnings warnings={warnings} />
      <HeroFinder options={options} />
      <div className="home-grid">
        <div className="home-main">
          <Carousel games={slides} options={options} />
        </div>
        <aside className="home-side" aria-label="계정">
          {ready && (user ? <ProfilePanel /> : <LoginPanel />)}
        </aside>
      </div>
      {rest.length > 0 && <Row title="인기 게임" games={rest} options={options} />}
    </div>
  );
}
