// 상단 메뉴: 인기 게임 · 신작·출시 예정 · 평점 랭킹 · 장르별 게임
import { useEffect, useRef, useState } from 'react';
import { usePageState } from '../lib/pageMemory.js';
import { api } from '../lib/api.js';
import { Link, navigate, useLocation } from '../lib/router.jsx';
import { GameTile } from '../components/GameTile.jsx';
import { AutoMore } from '../components/AutoMore.jsx';
import { ErrorState, Loading, Warnings } from '../components/Status.jsx';

const useParam = (name) => new URLSearchParams(useLocation().search).get(name) || '';

function setParam(pathname, search, name, value) {
  const sp = new URLSearchParams(search);
  if (value) sp.set(name, value);
  else sp.delete(name);
  const qs = sp.toString();
  navigate(`${pathname}${qs ? `?${qs}` : ''}`, { replace: true });
}

/** 칩 형태 선택 (전체 + 항목들) */
function ChipBar({ label, name, items, value, allLabel = '전체' }) {
  const { pathname, search } = useLocation();
  return (
    <div className="chipbar" role="group" aria-label={label}>
      {allLabel && (
        <button type="button" className={`chipbar-item${!value ? ' is-on' : ''}`} aria-pressed={!value} onClick={() => setParam(pathname, search, name, '')}>
          {allLabel}
        </button>
      )}
      {items.map((o) => (
        <button key={o.value} type="button" className={`chipbar-item${value === o.value ? ' is-on' : ''}`} aria-pressed={value === o.value} onClick={() => setParam(pathname, search, name, o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tabs({ name, items, value }) {
  const { pathname, search } = useLocation();
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} className={value === t.value ? 'is-on' : ''} onClick={() => setParam(pathname, search, name, t.value === items[0].value ? '' : t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 목록 불러오기 + 더 보기 */
function useBrowse(kind, params) {
  const key = JSON.stringify([kind, params]);
  // 불러온 목록을 기록 항목에 저장 → 상세를 보고 뒤로 오면 다시 받지 않고 떠나기 전 그대로
  const [state, setState] = usePageState(`browse:${key}`, { status: 'loading', games: [], hasMore: false, warnings: [], error: null, more: false });
  const restored = useRef(state.status === 'success');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (restored.current) {
      restored.current = false;
      if (state.more) setState((s) => ({ ...s, more: false })); // 더 불러오던 중에 떠났으면 다시 누를 수 있게
      return undefined;
    }
    let alive = true;
    setState({ status: 'loading', games: [], hasMore: false, warnings: [], error: null, more: false });
    api.browse(kind, params).then(
      (r) => alive && setState({ status: 'success', games: r.games, domestic: r.domestic ?? [], hasMore: r.hasMore, next: r.nextOffset, warnings: r.warnings || [], error: null, more: false }),
      (error) => alive && setState((s) => ({ ...s, status: 'error', error })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  const loadMore = async () => {
    setState((s) => ({ ...s, more: true }));
    try {
      const r = await api.browse(kind, { ...params, offset: state.next });
      setState((s) => {
        const seen = new Set(s.games.map((g) => g.id));
        return { ...s, games: [...s.games, ...r.games.filter((g) => !seen.has(g.id))], hasMore: r.hasMore, next: r.nextOffset, more: false };
      });
    } catch (error) {
      setState((s) => ({ ...s, more: false, moreError: error.message }));
    }
  };
  return { ...state, retry: () => setNonce((n) => n + 1), loadMore };
}

function GameGrid({ state, options, noteFor, emptyText, rankFrom }) {
  if (state.status === 'loading') return <Loading message="게임을 불러오는 중이에요…" />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.retry} />;
  return (
    <>
      <Warnings warnings={state.warnings} />
      {state.games.length === 0 ? (
        !state.warnings.length && (
          <div className="state" data-testid="browse-empty">
            <h2>{emptyText || '표시할 게임이 없어요'}</h2>
            <p className="muted">다른 조건을 골라 보세요.</p>
          </div>
        )
      ) : (
        <div className="card-grid" data-testid="browse-grid">
          {state.games.map((g, i) => (
            <GameTile key={g.id} game={g} options={options} note={noteFor?.(g)} rank={rankFrom != null ? rankFrom + i : undefined} />
          ))}
        </div>
      )}
      {state.hasMore && (
        <AutoMore onMore={state.loadMore} busy={state.more} error={state.moreError} watch={state.games.length} testid="browse-more">
          더 보기
        </AutoMore>
      )}
    </>
  );
}

function PageHead({ title, desc, children }) {
  return (
    <section className="page-head browse-head">
      <h1>{title}</h1>
      {desc && <p className="muted">{desc}</p>}
      {children}
    </section>
  );
}

const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : null);

export function PopularPage({ options }) {
  const platform = useParam('platform');
  const state = useBrowse('popular', { platform });
  return (
    <>
      <PageHead title="인기 게임" desc="IGDB에서 평가를 많이 받은 순서예요.">
        <ChipBar label="플랫폼" name="platform" items={options.platforms} value={platform} />
      </PageHead>
      <GameGrid state={state} options={options} />
    </>
  );
}

export function NewPage({ options }) {
  const tab = useParam('tab') || 'recent';
  const platform = useParam('platform');
  const state = useBrowse(tab === 'upcoming' ? 'upcoming' : 'recent', { platform });
  return (
    <>
      <PageHead title="신작·출시 예정" desc={tab === 'upcoming' ? '출시 전부터 관심이 많은 기대작이에요. 출시일은 바뀔 수 있어요.' : '최근 90일 안에 출시된 게임 중 관심이 많았던 순서예요.'}>
        <Tabs name="tab" value={tab} items={[{ value: 'recent', label: '최근 출시' }, { value: 'upcoming', label: '출시 예정' }]} />
        <ChipBar label="플랫폼" name="platform" items={options.platforms} value={platform} />
      </PageHead>
      <p className="muted small">출시일은 IGDB 기준(첫 출시일)이라 국내 출시일과 다를 수 있어요.</p>
      <GameGrid
        state={state}
        options={options}
        noteFor={(g) => (g.releaseDate ? `${fmtDate(g.releaseDate)} ${tab === 'upcoming' ? '출시 예정' : '출시'}` : '출시일 정보 없음')}
        emptyText={tab === 'upcoming' ? '출시 예정 게임이 없어요' : '최근 출시된 게임이 없어요'}
      />
      {tab === 'upcoming' && state.status === 'success' && state.domestic?.length > 0 && (
        <section className="result-section" aria-labelledby="domestic-upcoming" data-testid="domestic-upcoming">
          <header className="section-head">
            <h2 id="domestic-upcoming">
              국내 출시 예정 <span className="count">{state.domestic.length}</span>
            </h2>
            <p className="muted">게임물관리위원회 등급분류는 받았지만 아직 출시되지 않은 것으로 AI(Google Gemini)가 판단한 게임이에요. 틀릴 수 있어요.</p>
          </header>
          <div className="card-grid">
            {state.domestic.map((g) => (
              <GameTile key={g.id} game={g} options={options} note={g.ratingDate ? `${fmtDate(g.ratingDate)} 등급분류` : undefined} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function RankingPage({ options }) {
  const tab = useParam('tab') || 'global';
  return (
    <>
      <PageHead title="평점 랭킹" desc="전 세계 평점과 플레이픽 회원 평점을 따로 보여 드려요.">
        <Tabs name="tab" value={tab} items={[{ value: 'global', label: '글로벌 평점 TOP' }, { value: 'members', label: '회원 평점 TOP' }]} />
      </PageHead>
      {tab === 'members' ? <MemberRanking options={options} /> : <GlobalRanking options={options} />}
    </>
  );
}

function GlobalRanking({ options }) {
  const state = useBrowse('top', {});
  return (
    <>
      <p className="muted small">IGDB 종합 평점(100점 만점)을 5점 만점으로 바꾼 순위예요. 평가가 100개 이상인 게임만 포함해요.</p>
      <GameGrid state={state} options={options} rankFrom={1} />
    </>
  );
}

function MemberRanking({ options }) {
  const [state, setState] = useState({ status: 'loading', games: [], warnings: [] });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', games: [], warnings: [] });
    api.memberRanking().then(
      (r) => alive && setState({ status: 'success', games: r.games, warnings: r.warnings || [], hasMore: false }),
      (error) => alive && setState({ status: 'error', error, games: [], warnings: [] }),
    );
    return () => {
      alive = false;
    };
  }, [nonce]);
  return (
    <>
      <p className="muted small">플레이픽 회원이 남긴 별점 평균이 높은 순서예요. 평균이 같으면 평가가 많은 게임이 먼저 나와요.</p>
      <GameGrid state={{ ...state, retry: () => setNonce((n) => n + 1) }} options={options} rankFrom={1} emptyText="아직 회원 평점이 없어요. 게임 상세 화면에서 첫 평가를 남겨 보세요!" />
    </>
  );
}

export function GenrePage({ options, genre }) {
  const platform = useParam('platform');
  const current = options.genres.find((g) => g.value === genre);
  return (
    <>
      <PageHead title={current ? `${current.label} 게임` : '장르별 게임'} desc="장르를 고르면 그 장르의 인기 게임을 보여 드려요.">
        <nav className="chipbar" aria-label="장르">
          {options.genres.map((g) => (
            <Link key={g.value} to={`/genres/${g.value}${platform ? `?platform=${platform}` : ''}`} className={`chipbar-item${g.value === genre ? ' is-on' : ''}`} aria-current={g.value === genre ? 'page' : undefined}>
              {g.label}
            </Link>
          ))}
        </nav>
        {current && <ChipBar label="플랫폼" name="platform" items={options.platforms} value={platform} />}
      </PageHead>
      {current ? <GenreGrid genre={genre} platform={platform} options={options} /> : <p className="muted">위에서 장르를 골라 주세요.</p>}
    </>
  );
}

function GenreGrid({ genre, platform, options }) {
  const state = useBrowse('genre', { genre, platform });
  return <GameGrid state={state} options={options} />;
}
