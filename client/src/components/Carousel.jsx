import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router.jsx';
import { shortPlayers } from '../lib/format.js';
import { Cover } from './Cover.jsx';

/** 첫 화면 대표 게임 캐러셀 (5초마다 넘김, 마우스를 올리거나 포커스하면 멈춤) */
export function Carousel({ games, options }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);
  const count = games.length;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (paused || reduce || count < 2) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [paused, reduce, count]);

  useEffect(() => {
    const track = trackRef.current;
    const slide = track?.children[index];
    if (track && slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
  }, [index, reduce]);

  if (!count) return null;
  const go = (d) => setIndex((i) => (i + d + count) % count);
  const genreLabel = (g) => (g.genres || []).map((v) => options?.genres.find((o) => o.value === v)?.label).filter(Boolean).slice(0, 2).join('·');

  return (
    <section
      className="carousel"
      aria-roledescription="carousel"
      aria-label="추천 게임"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="carousel"
    >
      <div className="carousel-track" ref={trackRef}>
        {games.map((g, i) => {
          const summary = g.summaryKo || g.summary;
          return (
            <article key={g.id} className="slide" aria-roledescription="slide" aria-label={`${i + 1} / ${count}`} aria-hidden={i !== index}>
              <div className="slide-bg">{g.bannerUrl ? <img src={g.bannerUrl} alt="" referrerPolicy="no-referrer" /> : <Cover game={g} />}</div>
              <div className="slide-shade" />
              <div className="slide-content">
                <div className="slide-cover">
                  <Cover game={g} />
                </div>
                <div className="slide-text">
                  {g.isDemo && <span className="pill pill-demo">데모</span>}
                  <h2>{g.title}</h2>
                  <p className="slide-meta">{[shortPlayers(g), genreLabel(g), g.rating].filter(Boolean).join(' · ')}</p>
                  {summary && <p className="slide-summary">{summary}</p>}
                  <Link to={`/games/${encodeURIComponent(g.id)}`} className="btn btn-light" tabIndex={i === index ? 0 : -1}>
                    상세 정보 &amp; 구매
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {count > 1 && (
        <>
          <button type="button" className="carousel-nav prev" onClick={() => go(-1)} aria-label="이전 게임">
            ‹
          </button>
          <button type="button" className="carousel-nav next" onClick={() => go(1)} aria-label="다음 게임">
            ›
          </button>
          <div className="dots" role="tablist" aria-label="슬라이드 선택">
            {games.map((g, i) => (
              <button key={g.id} type="button" role="tab" aria-selected={i === index} aria-label={`${i + 1}번째: ${g.title}`} className={i === index ? 'is-active' : ''} onClick={() => setIndex(i)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
