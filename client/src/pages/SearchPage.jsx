import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { usePageState } from '../lib/pageMemory.js';
import { Link, useLocation } from '../lib/router.jsx';
import { GameTile } from '../components/GameTile.jsx';
import { AutoMore } from '../components/AutoMore.jsx';
import { EmptyState, ErrorState, Loading, Warnings } from '../components/Status.jsx';

const PAGE = 24;

export function SearchPage({ options }) {
  const { search } = useLocation();
  const q = (new URLSearchParams(search).get('q') || '').trim();
  const { status, data, error, retry } = useAsync(() => (q ? api.search(q) : Promise.resolve(null)), [q], 'search');
  const [shown, setShown] = usePageState(`search:${q}:shown`, PAGE); // 뒤로 가기로 돌아오면 펼친 만큼 그대로

  if (!q) return <EmptyState title="검색어를 입력해 주세요"><p>상단 검색창에 게임 이름을 입력하면 찾아 드려요.</p></EmptyState>;
  return (
    <>
      <section className="page-head">
        <h1>
          ‘{q}’ 검색 결과
        </h1>
      </section>
      {status === 'loading' && <Loading message="게임을 검색하는 중이에요…" />}
      {status === 'error' && <ErrorState error={error} onRetry={retry} />}
      {status === 'success' && (
        <>
          <Warnings warnings={data.warnings} />
          {data.games.length === 0 ? (
            <EmptyState title="검색 결과가 없어요">
              <p>철자를 확인하거나, 영문 제목으로도 검색해 보세요.</p>
              <SubmitHint />
            </EmptyState>
          ) : (
            <>
              <p className="result-count" data-testid="result-count">
                {data.games.length}개 게임
                {data.alsoSearched && <span className="muted small"> · ‘{data.alsoSearched}’(으)로도 함께 찾았어요</span>}
              </p>
              <div className="card-grid">
                {data.games.slice(0, shown).map((g) => (
                  <GameTile key={g.id} game={g} options={options} />
                ))}
              </div>
              {data.games.length > shown && (
                <AutoMore onMore={() => setShown((n) => n + PAGE)} watch={shown}>
                  더 보기 ({shown} / {data.games.length})
                </AutoMore>
              )}
              <SubmitHint />
            </>
          )}
        </>
      )}
    </>
  );
}

/** 찾는 게임이 없을 때: 게임 제보 안내 (로그인 안 했으면 제보 화면에서 로그인 안내) */
function SubmitHint() {
  return (
    <p className="submit-hint" data-testid="submit-hint">
      찾는 게임이 없나요?{' '}
      <Link to="/submit" className="btn btn-ghost btn-sm">
        게임 제보하기
      </Link>
    </p>
  );
}
