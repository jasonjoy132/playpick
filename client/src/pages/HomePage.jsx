import { useState } from 'react';
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
import { HomeContributors } from '../components/Contributors.jsx';

const HOME_CARDS = 8; // 첫 화면 인기 게임 카드 수 (4개씩 2줄)

/** 첫 화면 큰 안내: 인원·플랫폼을 바로 고르고 추천 목록으로 (장르까지는 '나만의 게임 찾기' 창). 오른쪽에 로그인·내 계정 */
function HeroFinder({ options, side }) {
  const { openFinder } = useFinder();
  const [players, setPlayers] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const criteria = { players, platforms, genres: [] };
  const go = () => (hasAnyCriteria(criteria) ? navigate(`/results?${criteriaToSearch(criteria)}`) : openFinder());
  const short = (o) => ({ ...o, label: o.value === 1 ? '혼자' : o.label });
  return (
    <section className="hero-finder" data-testid="hero-finder" aria-labelledby="hero-title">
      <div className="hero-main">
        <h1 id="hero-title">
          친구들과 같이 할 게임,
          <br />
          몇 명이서 하나요?
        </h1>
        <p>인원·플랫폼만 고르면 같이 하기 좋은 게임을 찾아 드려요.</p>
        <ChipGroup
          legend="함께할 인원"
          name="hero-players"
          type="radio"
          options={(options?.players ?? []).map(short)}
          isChecked={(v) => players === v}
          onToggle={(v) => setPlayers((p) => (p === v ? null : v))}
        />
        <div className="hero-row">
          <ChipGroup
            legend="플랫폼"
            name="hero-platforms"
            type="checkbox"
            options={options?.platforms ?? []}
            isChecked={(v) => platforms.includes(v)}
            onToggle={(v) => setPlatforms((l) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]))}
          />
          <button type="button" className="btn btn-primary btn-lg" onClick={go} data-testid="hero-go">
            추천 게임 찾기 →
          </button>
        </div>
        <button type="button" className="link-btn hero-more" onClick={() => openFinder(criteria)}>
          장르까지 고르기
        </button>
      </div>
      {side && (
        <aside className="hero-side" aria-label="계정">
          {side}
        </aside>
      )}
    </section>
  );
}

export function HomePage({ options }) {
  const { status, data, error, retry } = useAsync(() => api.featured(), [], 'featured');
  const { user, ready } = useAuth();

  if (status === 'loading') return <Loading message="추천 게임을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;

  const { games, slideCount, warnings } = data;
  const slides = games.slice(0, slideCount);
  const rest = games.slice(slideCount);

  return (
    <div className="home">
      <Warnings warnings={warnings} />
      <HeroFinder options={options} side={ready ? user ? <ProfilePanel /> : <LoginPanel /> : <div className="hero-side-empty" />} />
      {rest.length > 0 && (
        <section className="row" aria-labelledby="row-popular">
          <header className="row-head">
            <h2 id="row-popular">인기 게임</h2>
            <Link to="/popular" className="row-more">
              더 보기 →
            </Link>
          </header>
          <div className="home-cards">
            {rest.slice(0, HOME_CARDS).map((g) => (
              <GameTile key={g.id} game={g} options={options} wide />
            ))}
          </div>
        </section>
      )}
      {slides.length > 0 && (
        <section className="row" aria-labelledby="row-spotlight">
          <header className="row-head">
            <h2 id="row-spotlight">이번 주 주목할 게임</h2>
          </header>
          <Carousel games={slides} options={options} />
        </section>
      )}
      <HomeContributors />
    </div>
  );
}
