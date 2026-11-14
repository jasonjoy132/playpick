import { useEffect, useRef, useState } from 'react';
import { Link, navigate } from '../lib/router.jsx';
import { criteriaToSearch, hasAnyCriteria } from '../lib/criteria.js';
import { ChipGroup } from '../components/FinderModal.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useFinder } from '../lib/finder.jsx';
import { Carousel } from '../components/Carousel.jsx';
import { WishButton } from '../components/WishButton.jsx';
import { ErrorState, Loading, Warnings } from '../components/Status.jsx';
import { LoginPanel, ProfilePanel } from '../components/LoginPanel.jsx';
import { useAuth } from '../lib/auth.jsx';
import { HomeContributors } from '../components/Contributors.jsx';
import { Cover } from '../components/Cover.jsx';
import { shortPlayers } from '../lib/format.js';
import { BackdropTrailer, TrailerPeekProvider, usePeek } from '../components/TrailerPeek.jsx';

const POPULAR_COUNT = 6; // 인기 게임: 1위 큰 그림 + 2~6위 목록

/** 첫 화면 큰 그림으로 쓸 게임: 주목할 게임 중 여럿이 할 수 있고(추천 최대 2명 이상) 실제 게임 장면(IGDB 스크린샷, 없으면 아트워크)이 있는 첫 게임 */
function pickFeature(slides) {
  const artOf = (g) => g.screenshots?.[0] ?? g.bannerUrl ?? null; // 아트워크는 로고 글자만 큰 그림이 많아 장면 사진을 먼저
  const withArt = slides.filter(artOf).map((g) => ({ ...g, heroArt: artOf(g) }));
  return withArt.find((g) => (g.recommendedPlayers?.max ?? g.players?.max ?? 0) >= 2) ?? withArt[0] ?? null;
}
/** 게임의 가로 그림(장면 스크린샷 먼저, 없으면 아트워크) */
const sceneOf = (g) => g.screenshots?.[0] ?? g.bannerUrl ?? null;
/** 카드 아래 한 줄: 추천 인원 · 장르 두 개 */
function metaLine(game, options) {
  const players = shortPlayers(game)?.replace(/\s*\(싱글 플레이\)/, '');
  const genres = (game.genres ?? []).slice(0, 2).map((v) => options?.genres?.find((o) => o.value === v)?.label ?? v);
  return [players && `추천 ${players}`, genres.join('·')].filter(Boolean).join(' · ');
}

/**
 * 인기 게임(검은 띠, 화면 끝까지): 1위는 큰 장면 그림 위에 제목, 2~6위는 번호 목록.
 * 같은 크기 카드 격자 대신 순위가 한눈에 보이게
 */
/**
 * 화면에 처음 들어올 때 한 번만 보여 주기(data-reveal: hide → show). 처음부터 화면 안이면 그대로 둠.
 * JS·IntersectionObserver가 없으면 아무것도 숨기지 않음
 */
function useRevealOnce() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    el.dataset.reveal = 'hide';
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = 'show';
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -15% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function PopularBand({ games, options }) {
  const revealRef = useRevealOnce();
  const peek = usePeek();
  const [lead, ...list] = games;
  if (!lead) return null;
  const leadArt = sceneOf(lead);
  const href = (g) => `/games/${encodeURIComponent(g.id)}`;
  return (
    <section className="band band-dark home-popular" aria-labelledby="row-popular" data-testid="home-popular">
      <header className="band-head">
        <h2 id="row-popular">인기 게임</h2>
        <Link to="/popular" className="band-more">
          전체 순위 보기
        </Link>
      </header>
      <div className="pop-grid" ref={revealRef}>
        <article className="pop-lead" data-testid="game-card" data-game-id={lead.id}>
          <div className="pop-lead-art">
            {leadArt ? <img src={leadArt.replace('/t_screenshot_big/', '/t_screenshot_huge/')} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Cover game={lead} />}
          </div>
          <BackdropTrailer game={lead} />
          <div className="pop-lead-text">
            <span className="pop-rank" aria-label="1위">
              1
            </span>
            <h3>
              <Link to={href(lead)} className="stretched-link">
                {lead.title}
              </Link>
            </h3>
            <p>{metaLine(lead, options)}</p>
          </div>
          <WishButton game={lead} />
        </article>
        <ol className="pop-list" start={2}>
          {list.map((g, i) => {
            const art = sceneOf(g);
            return (
              <li key={g.id} className="pop-item" data-testid="game-card" data-game-id={g.id} {...peek(g)}>
                <span className="pop-rank" aria-hidden="true">
                  {i + 2}
                </span>
                <span className="pop-thumb">{art ? <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Cover game={g} />}</span>
                <span className="pop-text">
                  <Link to={href(g)} className="stretched-link">
                    {g.title}
                  </Link>
                  <span className="pop-meta">{metaLine(g, options)}</span>
                </span>
                <WishButton game={g} />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** IGDB 그림을 큰 화면용 크기로 (같은 그림, 해상도만 1080p) */
const bigArt = (url) => url.replace('/t_screenshot_big/', '/t_1080p/');

/**
 * 첫 화면: 화면 끝까지 깔린 게임 장면(트레일러가 있으면 소리 없이 재생) 위에 왼쪽 큰 제목과 인원·플랫폼 고르기, 오른쪽 아래 그 게임으로 가는 카드 하나.
 * 그림이 없으면 예전처럼 흰 바탕(no-art).
 * 장르까지는 '나만의 게임 찾기' 창
 */
function HeroFinder({ options, feature, pending }) {
  const { openFinder } = useFinder();
  const [players, setPlayers] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const criteria = { players, platforms, genres: [] };
  const go = () => (hasAnyCriteria(criteria) ? navigate(`/results?${criteriaToSearch(criteria)}`) : openFinder());
  const short = (o) => ({ ...o, label: o.value === 1 ? '혼자' : o.label });
  return (
    <section className={`hero-finder hero-mag${feature || pending ? '' : ' no-art'}${feature || pending ? ' hero-full' : ''}`} data-testid="hero-finder" aria-labelledby="hero-title" data-enter>
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
            추천 게임 찾기
            <svg className="btn-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <button type="button" className="link-btn hero-more" onClick={() => openFinder(criteria)}>
          장르까지 고르기
        </button>
      </div>
      {!feature && pending && <div className="hero-art is-pending" aria-hidden="true" />}
      {feature && (
        <figure className="hero-art">
          <img src={bigArt(feature.heroArt)} alt={`${feature.title} 게임 화면`} referrerPolicy="no-referrer" fetchPriority="high" />
          <BackdropTrailer game={feature} testId="hero-trailer" />
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

  // 첫 화면 제목·고르기는 목록 없이도 바로 쓸 수 있게 먼저 보여 줌 (그림 자리만 비워 둠)
  if (status !== 'success') {
    return (
      <div className="home">
        <HeroFinder options={options} pending={status === 'loading'} />
        {status === 'loading' ? <Loading message="추천 게임을 불러오는 중이에요…" /> : <ErrorState error={error} onRetry={retry} />}
      </div>
    );
  }

  const { games, slideCount, warnings } = data;
  const slides = games.slice(0, slideCount);
  const rest = games.slice(slideCount);
  const feature = pickFeature(slides);
  // 첫 화면 큰 그림 게임은 아래 '주목할 게임'에서 빼서 같은 게임이 두 번 나오지 않게 (그것뿐이면 그대로)
  const spotlight = slides.filter((g) => g.id !== feature?.id);
  const side = ready ? user ? <ProfilePanel /> : <LoginPanel /> : <div className="hero-side-empty" />;

  return (
    <TrailerPeekProvider>
    <div className="home">
      <Warnings warnings={warnings} />
      <HeroFinder options={options} feature={feature} />
      <PopularBand games={rest.slice(0, POPULAR_COUNT)} options={options} />
      {slides.length > 0 && (
        <section className="row" aria-labelledby="row-spotlight">
          <header className="row-head">
            <h2 id="row-spotlight">이번 주 주목할 게임</h2>
          </header>
          <Carousel games={spotlight.length ? spotlight : slides} options={options} />
        </section>
      )}
      <section className="band band-soft home-community" aria-labelledby="row-community">
        <div className="community-main">
          <h2 id="row-community">게임 정보는 회원이 같이 다듬어요</h2>
          <p className="community-lead">추천 인원·플레이 시간·구매처가 틀렸거나 비어 있으면 제보해 주세요. 관리자가 확인한 뒤 반영되고, 기여한 만큼 명예의 전당에 올라가요.</p>
          <HomeContributors />
          <Link to="/hall-of-fame" className="btn btn-ghost community-more">
            명예의 전당 보기
          </Link>
        </div>
        <aside className="hero-side" aria-label="계정">
          {side}
        </aside>
      </section>
    </div>
    </TrailerPeekProvider>
  );
}
