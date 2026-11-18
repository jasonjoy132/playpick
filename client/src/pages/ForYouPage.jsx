// 나를 위한 추천(회원 전용): 별점·찜·최근 본 게임으로 만든 취향에 맞는 게임 — 카드마다 추천 이유 한 줄
import { api } from '../lib/api.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useAsync } from '../lib/useAsync.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { GameTile } from '../components/GameTile.jsx';
import { ErrorState, Loading } from '../components/Status.jsx';

export function ForYouPage({ options }) {
  const { user, ready } = useAuth();
  useDocumentTitle('나를 위한 추천');
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <div className="state" data-testid="for-you-login">
        <h1>나를 위한 추천은 회원 전용이에요</h1>
        <p className="muted">찜하거나 별점을 남긴 게임을 보고, 취향에 맞는 게임을 이유와 함께 골라 드려요.</p>
        <Link to={`/login?next=${encodeURIComponent('/for-you')}`} className="btn btn-gold">
          로그인
        </Link>
      </div>
    );
  }
  return <ForYouList options={options} userId={user.id} />;
}

function ForYouList({ options, userId }) {
  const { status, data, error, retry } = useAsync(() => api.forYou(), [userId], 'for-you');
  return (
    <div className="for-you" data-testid="for-you">
      <section className="page-head browse-head">
        <h1>나를 위한 추천</h1>
        <p className="muted">
          {data?.topGenres?.length
            ? `별점·찜·최근 본 게임을 보면 ${data.topGenres.join('·')} 게임을 좋아하시네요. 비슷한 장르, 즐겨 하는 인원, 내 플랫폼에 맞는 게임이에요.`
            : '별점·찜·최근 본 게임을 보고 취향에 맞는 게임을 골라요.'}
        </p>
      </section>
      {status === 'loading' && <Loading message="취향에 맞는 게임을 고르는 중이에요…" />}
      {status === 'error' &&
        (error.code === 'LOGIN_REQUIRED' ? (
          // 로그인이 풀린 채로 들어온 경우: 다시 시도 대신 로그인 안내
          <div className="state" data-testid="for-you-login">
            <h2>로그인이 풀렸어요</h2>
            <p className="muted">다시 로그인하면 취향에 맞는 게임을 골라 드려요.</p>
            <Link to={`/login?next=${encodeURIComponent('/for-you')}`} className="btn btn-gold">
              로그인
            </Link>
          </div>
        ) : (
          <ErrorState error={error} onRetry={retry} />
        ))}
      {status === 'success' && (
        <>
          {data.needMore && (
            <p className="notice for-you-more" data-testid="for-you-need-more">
              아직 활동이 적어서 추천이 대략적이에요. 마음에 드는 게임을 찜하거나 별점을 남기면 더 잘 맞춰 드려요.
            </p>
          )}
          {data.games.length === 0 ? (
            <div className="state" data-testid="for-you-empty">
              <h2>지금은 추천할 게임이 없어요</h2>
              <p className="muted">
                <Link to="/popular">인기 게임</Link>에서 마음에 드는 게임을 찜해 보세요.
              </p>
            </div>
          ) : (
            <>
              <h2 className="sr-only">추천 게임 목록</h2>
              <div className="card-grid" data-testid="browse-grid">
                {data.games.map((g) => (
                  <GameTile key={g.id} game={g} options={options} note={g.forYouReason} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
