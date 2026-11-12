import { Link } from '../lib/router.jsx';
import { shortPlayers } from '../lib/format.js';
import { Cover } from './Cover.jsx';
import { MatchBadges, MatchSummary } from './MatchBadges.jsx';
import { WishButton } from './WishButton.jsx';

function labelOf(values, options) {
  if (!values?.length || !options) return null;
  return values.map((v) => options.find((o) => o.value === v)?.label || v);
}

/**
 * 표지 중심 게임 카드 (추천·인기·랭킹·장르·검색 공통). 콘솔 스토어처럼 표지는 카드 너비 그대로, 글은 표지 아래 세 줄:
 * 제목 / 추천 인원 · 장르 / 평점 · 플랫폼 · 등급. 표지 위에는 하트와 상태(데모·제보·출시 예정·새 등급분류)만.
 * 일부 조건 일치 카드에만 조건 배지를 붙임(모든 조건 일치는 목록 머리에서 이미 말함).
 * showOriginal: 검색 결과처럼 원래 이름이 도움이 될 때 원제 한 줄. wide: 가로 그림(IGDB 아트워크·스크린샷)이 있으면 가로 카드
 */
export function GameTile({ game, options, search, evaluation, size = 'md', rank, note, wide = false, showOriginal = false }) {
  const href = `/games/${encodeURIComponent(game.id)}${search ? `?${search}` : ''}`;
  const platforms = labelOf(game.platforms, options?.platforms);
  const genres = labelOf(game.genres, options?.genres);
  const players = shortPlayers(game)?.replace(/\s*\(싱글 플레이\)/, ''); // 카드는 짧게 ('(AI)' 표시는 남김)
  const partial = evaluation && !evaluation.isFullMatch;
  const g = game.globalRating?.count ? game.globalRating : null;
  const m = game.userRating?.count ? game.userRating : null;
  const foot = [
    platforms?.length ? `${platforms[0]}${platforms.length > 1 ? ` +${platforms.length - 1}` : ''}` : null,
    game.rating && !game.isDemo ? game.rating : null,
    game.releaseDate ? game.releaseDate.slice(0, 4) : null,
  ].filter(Boolean);
  return (
    <article className={`tile tile-${size}${wide ? ' tile-wide' : ''}`} data-testid="game-card" data-game-id={game.id}>
      <div className="tile-cover">
        {wide && game.bannerUrl ? (
          <img className="cover" src={game.bannerUrl} alt={`${game.title} 게임 화면`} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <Cover game={game} />
        )}
        {rank != null && (
          <span className={`rank${rank <= 3 ? ' is-top' : ''}`} aria-label={`${rank}위`}>
            {rank}
          </span>
        )}
        {(game.isDemo || game.source === '사용자 제보' || game.aiUpcoming || game.aiRecent) && (
          <div className="tile-badges">
            {game.isDemo && <span className="pill pill-demo">데모</span>}
            {game.source === '사용자 제보' && <span className="pill pill-user" title="회원이 제보하고 관리자가 확인한 게임">제보</span>}
            {game.aiUpcoming && <span className="pill pill-wait" title={game.statusEvidence ? `${game.statusEvidence}에 출시 예정으로 올라온 게임` : '아직 출시되지 않은 것으로 AI가 판단한 게임'}>출시 예정</span>}
            {game.aiRecent && <span className="pill pill-new" title="최근 국내 등급분류를 받은 게임(서비스 상태 확인 전)">새 등급분류</span>}
          </div>
        )}
        <WishButton game={game} />
      </div>
      <div className="tile-body">
        {partial && <MatchSummary evaluation={evaluation} />}
        <h3 className="tile-title">
          <Link to={href} className="stretched-link">
            {game.title}
          </Link>
        </h3>
        {showOriginal && game.originalTitle && <p className="tile-sub">{game.originalTitle}</p>}
        {note && <p className="tile-note">{note}</p>}
        <p className="tile-meta">
          <span className={players ? 'tile-players' : 'tile-players is-empty'}>{players ? `추천 ${players}` : '인원 정보 없음'}</span>
          {genres?.length > 0 && <span> · {genres.slice(0, 2).join('·')}</span>}
        </p>
        {(g || m || foot.length > 0) && (
          <p className="tile-foot">
            {g && (
              <span className="tile-score" aria-label={`글로벌 평점 5점 만점에 ${g.avg}점`}>
                <span aria-hidden="true">★</span> {g.avg.toFixed(1)}
              </span>
            )}
            {m && (
              <span className="tile-score" aria-label={`회원 평점 5점 만점에 ${m.avg}점, ${m.count}명 평가`}>
                회원 <span aria-hidden="true">★</span> {m.avg.toFixed(1)}
              </span>
            )}
            {foot.length > 0 && <span className="tile-facts" title={platforms?.join(', ')}>{foot.join(' · ')}</span>}
          </p>
        )}
        {partial && <MatchBadges evaluation={evaluation} compact />}
      </div>
    </article>
  );
}
