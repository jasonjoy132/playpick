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
import { Cover } from '../components/Cover.jsx';
import { shortPlayers } from '../lib/format.js';

const HOME_CARDS = 6; // 인기 게임 카드 수 (로그인 창 옆에 3개씩 2줄)

/** 첫 화면 큰 그림으로 쓸 게임: 주목할 게임 중 여럿이 할 수 있고(추천 최대 2명 이상) 실제 게임 장면(IGDB 스크린샷, 없으면 아트워크)이 있는 첫 게임 */
function pickFeature(slides) {
  const artOf = (g) => g.screenshots?.[0] ?? g.bannerUrl ?? null; // 아트워크는 로고 글자만 큰 그림이 많아 장면 사진을 먼저
  const withArt = slides.filter(artOf).map((g) => ({ ...g, heroArt: artOf(g) }));
  return withArt.find((g) => (g.recommendedPlayers?.max ?? g.players?.max ?? 0) >= 2) ?? withArt[0] ?? null;
}
/** IGDB 그림을 큰 화면용 크기로 (같은 그림, 해상도만 1080p) */
const bigArt = (url) => url.replace('/t_screenshot_big/', '/t_1080p/');

/**
 * 첫 화면(매거진형): 왼쪽에 큰 제목과 인원·플랫폼 고르기, 오른쪽에 화면 높이만큼 큰 실제 게임 그림 + 그 게임으로 가는 카드 하나.
 * 장르까지는 '나만의 게임 찾기' 창
 */
function HeroFinder({ options, feature }) {
  const { openFinder } = useFinder();
  const [players, setPlayers] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const criteria = { players, platforms, genres: [] };
  const go = () => (hasAnyCriteria(criteria) ? navigate(`/results?${criteriaToSearch(criteria)}`) : openFinder());
  const short = (o) => ({ ...o, label: o.value === 1 ? '혼자' : o.label });
  return (
    <section className={`hero-finder hero-mag${feature ? '' : ' no-art'}`} data-testid="hero-finder" aria-labelledby="hero-title" data-enter>
      <div className="hero-main">
        <h1 id="hero-title">
          친구들과
          <br />
          같이 할 게임,
          <br />
          몇 명이서 하나요?
        </h1>
        <p className="hero-lead">인원과 플랫폼만 고르면 같이 하기 좋은 게임을 찾아 드려요.</p>
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
      {feature && (
        <figure className="hero-art">
          <img src={bigArt(feature.heroArt)} alt={`${feature.title} 게임 화면`} referrerPolicy="no-referrer" fetchPriority="high" />
          <Link to={`/games/${encodeURIComponent(feature.id)}`} className="hero-feature" data-testid="hero-feature">
            <span className="hero-feature-cover">
              <Cover game={feature} />
            </span>
            <span className="hero-feature-text">
              <b>{feature.title}</b>
              {shortPlayers(feature) && <span className="hero-feature-players">추천 {shortPlayers(feature)}</span>}
            </span>
            <span className="hero-feature-go" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
        </figure>
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
  const feature = pickFeature(slides);
  // 첫 화면 큰 그림 게임은 아래 '주목할 게임'에서 빼서 같은 게임이 두 번 나오지 않게 (그것뿐이면 그대로)
  const spotlight = slides.filter((g) => g.id !== feature?.id);
  const side = ready ? user ? <ProfilePanel /> : <LoginPanel /> : <div className="hero-side-empty" />;

  return (
    <div className="home">
      <Warnings warnings={warnings} />
      <HeroFinder options={options} feature={feature} />
      <section className="row home-feed" aria-labelledby="row-popular">
        <div className="home-feed-main">
          <header className="row-head">
            <h2 id="row-popular">인기 게임</h2>
            <Link to="/popular" className="row-more">
              더 보기 →
            </Link>
          </header>
          {rest.length > 0 && (
            <div className="home-cards">
              {rest.slice(0, HOME_CARDS).map((g) => (
                <GameTile key={g.id} game={g} options={options} wide />
              ))}
            </div>
          )}
        </div>
        <aside className="hero-side" aria-label="계정">
          {side}
        </aside>
      </section>
      {slides.length > 0 && (
        <section className="row" aria-labelledby="row-spotlight">
          <header className="row-head">
            <h2 id="row-spotlight">이번 주 주목할 게임</h2>
          </header>
          <Carousel games={spotlight.length ? spotlight : slides} options={options} />
        </section>
      )}
      <HomeContributors />
    </div>
  );
}
