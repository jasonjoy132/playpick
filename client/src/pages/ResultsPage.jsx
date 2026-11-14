import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { recall, remember, usePageState } from '../lib/pageMemory.js';
import { navigate, useLocation } from '../lib/router.jsx';
import { useFinder } from '../lib/finder.jsx';
import { criteriaFromSearch, criteriaToSearch, hasAnyCriteria } from '../lib/criteria.js';
import { criteriaLabels } from '../lib/format.js';
import { GameTile } from '../components/GameTile.jsx';
import { AutoMore } from '../components/AutoMore.jsx';
import { EmptyState, ErrorState, Loading, Warnings } from '../components/Status.jsx';

// 정렬: 추천순(기본, 인기순 + 국내 게임을 사이사이에) · 평가 수 · 평점 (서버가 조건에 맞는 IGDB 게임 전체를 그 순서로 찾음)
// 평가·평점은 버튼 하나로 — 처음 누르면 많은/높은 순(↑), 고른 버튼을 다시 누르면 적은/낮은 순(↓). 고른 버튼은 전체 이름(평점 낮은 순 등), 안 고른 버튼은 짧게
const SORTS = [
  { key: 'match', label: '추천순' },
  { key: 'count', label: '평가 순', desc: '평가 많은 순', asc: '평가 적은 순' },
  { key: 'rating', label: '평점 순', desc: '평점 높은 순', asc: '평점 낮은 순' },
];
const ORDERS = ['match', 'count', 'count_asc', 'rating', 'rating_asc'];

function SortArrow({ up }) {
  return (
    <svg className={`sort-arrow${up ? ' is-up' : ''}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M4 9l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ResultsPage({ options }) {
  const { search } = useLocation();
  const { openFinder } = useFinder();
  const criteria = criteriaFromSearch(search);
  const order = ORDERS.find((o) => o === new URLSearchParams(search).get('order')) ?? 'match';
  const asc = order.endsWith('_asc');
  const sortKey = order.replace('_asc', '');
  const goOrder = (o) => navigate(`/results?${o === 'match' ? criteriaToSearch(criteria) : `${criteriaToSearch(criteria)}&order=${o}`}`, { replace: true });
  // 정렬도 주소에 남겨 뒤로 가기·상세에서 돌아올 때 그대로
  const qs = order === 'match' ? criteriaToSearch(criteria) : `${criteriaToSearch(criteria)}&order=${order}`;
  const { status, data, error, retry } = useAsync(
    () => (hasAnyCriteria(criteria) ? api.recommendations(qs) : Promise.resolve(null)),
    [qs],
    'results', // 뒤로 가기로 돌아오면 다시 받지 않음
  );

  if (!hasAnyCriteria(criteria)) {
    return <ErrorState title="선택된 조건이 없어요" error={{ message: '‘나만의 게임 찾기’에서 인원·플랫폼·장르를 선택해 주세요.' }} editCriteria={criteria} />;
  }

  return (
    <>
      <section className="page-head">
        <h1>추천 게임 목록</h1>
        <div className="criteria-summary" aria-label="선택한 조건">
          {criteriaLabels(criteria, options).map((l) => (
            <span key={l.key} className="criteria-pill">
              <b>{l.label}</b> {l.value}
            </span>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openFinder(criteria)} data-testid="edit-criteria">
            조건 변경
          </button>
        </div>
        <div className="tabs tabs-sub" role="tablist" aria-label="정렬">
          {SORTS.map((o) => {
            const on = sortKey === o.key;
            const down = on && asc; // 지금 낮은/적은 순
            return (
              <button
                key={o.key}
                type="button"
                role="tab"
                aria-selected={on}
                className={on ? 'is-on' : ''}
                aria-label={o.asc ? (down ? o.asc : o.desc) : undefined}
                title={o.asc ? (on ? `${down ? o.asc : o.desc} · 다시 누르면 ${down ? o.desc : o.asc}` : o.desc) : undefined}
                onClick={() => goOrder(o.asc && on ? (asc ? o.key : `${o.key}_asc`) : o.key)}
              >
                {on && o.asc ? (down ? o.asc : o.desc) : o.label}
                {on && o.asc && <SortArrow up={!down} />}
              </button>
            );
          })}
        </div>
      </section>

      {status === 'loading' && <Loading message="조건에 맞는 게임을 찾는 중이에요…" />}
      {status === 'error' && <ErrorState error={error} onRetry={retry} editCriteria={criteria} />}
      {status === 'success' && <Results data={data} options={options} qs={qs} criteria={criteria} />}
    </>
  );
}

function Results({ data, options, qs, criteria }) {
  const { totalGames, warnings = [] } = data;
  // IGDB 전체 검색 + IGDB에 없는 게임위 게임을 한 목록으로. '더 보기'는 섹션별로 서버에서 이어 받음
  // 더 불러온 목록·위치는 기록 항목에 저장 → 상세를 보고 뒤로 오면 떠나기 전 그대로
  const m = `results:${qs}`;
  const [full, setFull] = usePageState(`${m}:full`, data.fullMatches);
  const [partial, setPartial] = usePageState(`${m}:partial`, data.partialMatches);
  const [cursor, setCursor] = usePageState(`${m}:cursor`, () => ({ ...(data.next ?? {}), igdbDone: !!data.igdbDone }));
  const [more, setMore] = usePageState(`${m}:more`, () => ({ full: !!data.hasMoreFull, partial: !!data.hasMorePartial }));
  const [loading, setLoading] = useState(null);
  const [moreError, setMoreError] = useState(null);
  const [fullShown, setFullShown] = usePageState(`${m}:shown-full`, PAGE); // 모든 조건 일치 중 화면에 펼친 개수
  useEffect(() => {
    if (recall(`${m}:data`) === data) return; // 뒤로 가기로 돌아온 같은 데이터면 저장해 둔 상태 그대로
    remember(`${m}:data`, data);
    setFull(data.fullMatches);
    setPartial(data.partialMatches);
    setCursor({ ...(data.next ?? {}), igdbDone: !!data.igdbDone });
    setMore({ full: !!data.hasMoreFull, partial: !!data.hasMorePartial });
    setMoreError(null);
    setFullShown(PAGE);
  }, [data]);

  const append = (cur, add) => {
    const seen = new Set(cur.map((x) => x.game.id));
    return [...cur, ...add.filter((x) => !seen.has(x.game.id))];
  };
  async function loadMore(section) {
    setLoading(section);
    setMoreError(null);
    try {
      const params = new URLSearchParams({ more: section, offset: cursor.offset ?? 0, goffset: cursor.goffset ?? 0 });
      if (cursor.igdbDone) params.set('igdbDone', '1');
      const r = await api.recommendations(`${qs}&${params}`);
      // 게임위 게임은 판정 결과에 따라 두 섹션 어디로든 올 수 있어서 둘 다 이어 붙임
      setFull((cur) => append(cur, r.fullMatches));
      setPartial((cur) => append(cur, r.partialMatches));
      if (section === 'full') {
        setMore((m) => ({ ...m, full: !!r.hasMoreFull }));
        setCursor({ ...r.next, igdbDone: !!r.igdbDone });
      } else {
        setMore((m) => ({ ...m, partial: !!r.hasMorePartial }));
        setCursor((c) => ({ ...c, goffset: r.next.goffset }));
      }
    } catch (e) {
      setMoreError(e.message || '더 불러오지 못했어요.');
    } finally {
      setLoading(null);
    }
  }

  if (full.length + partial.length === 0 && !more.full && !more.partial)
    return (
      <>
        <Warnings warnings={warnings} />
        <EmptyState criteria={criteria} />
      </>
    );
  const remote = (section) =>
    data.paged ? { hasMore: more[section], loading: loading === section, error: loading ? null : moreError, onMore: () => loadMore(section) } : null;
  const n = data.totalFull;
  // '일부 조건 일치'는 모든 조건 일치를 끝까지 다 본 뒤에만 '비슷한 게임'으로 이어서 보여 줌
  // (결과가 많으면 끝에 닿지 않아 묻히지 않고, 적으면 다 본 뒤 자연스럽게 더 볼 수 있음). 0개면 바로 보여 줌
  const noFull = full.length === 0 && !more.full;
  const fullDone = !more.full && full.length <= fullShown;
  const showSimilar = fullDone && (partial.length > 0 || more.partial);
  const similarCount = `${partial.length}${more.partial ? '+' : ''}`;
  return (
    <div className="results">
      <Warnings warnings={warnings} />
      <p className="result-count" data-testid="result-count">
        {noFull ? (
          <>
            모든 조건에 맞는 게임은 없어요. 일부 조건에 맞는 <b>비슷한 게임 {similarCount}개</b>를 보여 드려요.
          </>
        ) : data.paged ? (
          <>
            IGDB와 게임물관리위원회 전체에서 찾았어요. 모든 조건에 맞는 게임 <b>{n != null ? `약 ${n.toLocaleString('ko-KR')}개 이상` : '여러 개'}</b>({ORDER_NOTE[data.order] ?? '인기순'}).
          </>
        ) : (
          <>
            전체 {totalGames}개 게임 중 <b>{full.length}개</b>가 모든 조건에 일치해요.
          </>
        )}
      </p>
      {!noFull && (
        <ResultSection
          id="full" title="모든 조건 일치" desc="선택한 조건을 모두 만족하는 게임" items={full}
          total={data.paged && n != null ? n : null} totalPlus
          options={options} qs={qs} remote={remote('full')}
          shown={fullShown} setShown={setFullShown}
        />
      )}
      {showSimilar && (
        <ResultSection
          id="partial" title="비슷한 게임"
          desc={`${noFull ? '' : '모든 조건 일치 게임을 다 봤어요. '}일부 조건만 맞는 게임이에요 · ✓ 일치 · ✕ 불일치 · ? 정보 없음`}
          items={partial} options={options} qs={qs} remote={remote('partial')} memo={`${m}:shown-partial`}
        />
      )}
    </div>
  );
}

const PAGE = 24;
const ORDER_NOTE = {
  count: '평가 많은 순',
  count_asc: '평가 적은 순 — 평가 없는 게임은 맨 뒤',
  rating: '평점 높은 순 — 평가 50개 이상 먼저',
  rating_asc: '평점 낮은 순 — 평가 50개 이상 먼저',
};

function ResultSection({ id, title, desc, items, total, totalPlus, options, qs, emptyText, remote, maxAuto = Infinity, shown: shownProp, setShown: setShownProp, memo }) {
  const [ownShown, setOwnShown] = usePageState(memo ?? 'results:shown', PAGE);
  // 펼친 개수를 부모가 알아야 하면(모든 조건 일치를 다 봤는지) 부모 상태를 씀
  const shown = shownProp ?? ownShown;
  const setShown = setShownProp ?? setOwnShown;
  return (
    <section className="result-section" aria-labelledby={`sec-${id}`} data-testid={`section-${id}`}>
      <header className="section-head">
        <h2 id={`sec-${id}`}>
          {title} <span className="count">{total != null ? `${total.toLocaleString('ko-KR')}${totalPlus ? '+' : ''}` : `${items.length}${remote?.hasMore ? '+' : ''}`}</span>
        </h2>
        <p className="muted">{desc}</p>
      </header>
      {items.length === 0 && !remote?.hasMore ? (
        <p className="section-empty">{emptyText}</p>
      ) : (
        <>
          <div className="card-grid">
            {items.slice(0, shown).map(({ game, evaluation }) => (
              <GameTile key={game.id} game={game} evaluation={evaluation} options={options} search={qs} />
            ))}
          </div>
          {remote ? (
            items.length > shown ? (
              <AutoMore onMore={() => setShown((n) => n + PAGE)} watch={shown} maxAuto={maxAuto} testid={`more-${id}`}>
                더 보기
              </AutoMore>
            ) : remote.hasMore ? (
              <AutoMore
                onMore={() => remote.onMore().then(() => setShown((n) => n + PAGE))}
                busy={remote.loading} error={remote.error} watch={items.length} maxAuto={maxAuto} testid={`more-${id}`}
              >
                더 보기
              </AutoMore>
            ) : null
          ) : items.length > shown && (
            <AutoMore onMore={() => setShown((n) => n + PAGE)} watch={shown} maxAuto={maxAuto} testid={`more-${id}`}>
              더 보기 ({shown} / {items.length})
            </AutoMore>
          )}
        </>
      )}
    </section>
  );
}

