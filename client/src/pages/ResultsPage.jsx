import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useLocation } from '../lib/router.jsx';
import { useFinder } from '../lib/finder.jsx';
import { criteriaFromSearch, criteriaToSearch, hasAnyCriteria } from '../lib/criteria.js';
import { criteriaLabels } from '../lib/format.js';
import { GameTile } from '../components/GameTile.jsx';
import { AutoMore } from '../components/AutoMore.jsx';
import { EmptyState, ErrorState, Loading, Warnings } from '../components/Status.jsx';

export function ResultsPage({ options }) {
  const { search } = useLocation();
  const { openFinder } = useFinder();
  const criteria = criteriaFromSearch(search);
  const qs = criteriaToSearch(criteria);
  const { status, data, error, retry } = useAsync(
    () => (hasAnyCriteria(criteria) ? api.recommendations(qs) : Promise.resolve(null)),
    [qs],
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
  const [full, setFull] = useState(data.fullMatches);
  const [partial, setPartial] = useState(data.partialMatches);
  const [cursor, setCursor] = useState({ ...(data.next ?? {}), igdbDone: !!data.igdbDone });
  const [more, setMore] = useState({ full: !!data.hasMoreFull, partial: !!data.hasMorePartial });
  const [loading, setLoading] = useState(null);
  const [moreError, setMoreError] = useState(null);
  useEffect(() => {
    setFull(data.fullMatches);
    setPartial(data.partialMatches);
    setCursor({ ...(data.next ?? {}), igdbDone: !!data.igdbDone });
    setMore({ full: !!data.hasMoreFull, partial: !!data.hasMorePartial });
    setMoreError(null);
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
  return (
    <div className="results">
      <Warnings warnings={warnings} />
      <p className="result-count" data-testid="result-count">
        {data.paged ? (
          <>
            IGDB와 게임물관리위원회 전체에서 찾았어요. 모든 조건에 맞는 게임 <b>{n != null ? `약 ${n.toLocaleString('ko-KR')}개 이상` : '여러 개'}</b>(인기순)
            {partial.length > 0 && <>, 일부 조건에 맞는 게임 <b>{partial.length}{more.partial ? '+' : ''}개</b></>}.
          </>
        ) : (
          <>
            전체 {totalGames}개 게임 중 <b>{full.length}개</b>가 모든 조건에 일치하고, <b>{partial.length}개</b>가 일부 조건에 일치해요.
          </>
        )}
      </p>
      <ResultSection
        id="full" title="모든 조건 일치" desc="선택한 조건을 모두 만족하는 게임" items={full}
        total={data.paged && n != null ? n : null} totalPlus
        options={options} qs={qs} emptyText="모든 조건을 만족하는 게임은 없어요. 아래 일부 일치 게임을 확인해 보세요."
        remote={remote('full')}
        // 아래에 '일부 조건 일치'가 있으면 스크롤 자동 불러오기는 3번까지(그다음은 버튼) — 끝없이 늘어나 아래 섹션에 못 가는 것 방지
        maxAuto={partial.length > 0 || more.partial ? 3 : Infinity}
      />
      {(partial.length > 0 || more.partial) && (
        <ResultSection
          id="partial" title="일부 조건 일치" desc="✓ 일치 · ✕ 불일치 · ? 데이터에 정보 없음" items={partial}
          options={options} qs={qs} remote={remote('partial')}
        />
      )}
    </div>
  );
}

const PAGE = 24;

function ResultSection({ id, title, desc, items, total, totalPlus, options, qs, emptyText, remote, maxAuto = Infinity }) {
  const [shown, setShown] = useState(PAGE);
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

