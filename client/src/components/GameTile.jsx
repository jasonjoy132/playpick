import { Link } from '../lib/router.jsx';
import { shortPlayers } from '../lib/format.js';
import { Cover } from './Cover.jsx';
import { MatchBadges, MatchSummary } from './MatchBadges.jsx';
import { WishButton } from './WishButton.jsx';
import { RatingPair } from './Stars.jsx';

function labelOf(values, options) {
  if (!values?.length || !options) return null;
  return values.map((v) => options.find((o) => o.value === v)?.label || v);
}

/** 표지 중심 게임 카드 (첫 화면·검색·추천 목록 공통) */
export function GameTile({ game, options, search, evaluation, size = 'md', rank, note }) {
  const href = `/games/${encodeURIComponent(game.id)}${search ? `?${search}` : ''}`;
  const platforms = labelOf(game.platforms, options?.platforms);
  const genres = labelOf(game.genres, options?.genres);
  const players = shortPlayers(game)?.replace(/\s*\(싱글 플레이\)/, ''); // 카드 알약은 짧게 ('(AI)' 표시는 남김)
  const meta = genres?.slice(0, 2).join('·');
  return (
    <article className={`tile tile-${size}`} data-testid="game-card" data-game-id={game.id}>
      <div className="tile-cover">
        <Cover game={game} />
        {rank != null && (
          <span className={`rank${rank <= 3 ? ' is-top' : ''}`} aria-label={`${rank}위`}>
            {rank}
          </span>
        )}
        <div className="tile-badges">
          {platforms?.length > 0 && (
            <span className="pill pill-dark" title={platforms.join(', ')}>
              {platforms[0]}
              {platforms.length > 1 && ` +${platforms.length - 1}`}
            </span>
          )}
          {game.isDemo && <span className="pill pill-demo">데모</span>}
          {game.source === '사용자 제보' && <span className="pill pill-user" title="회원이 제보하고 관리자가 확인한 게임">제보</span>}
          {game.aiUpcoming && <span className="pill pill-wait" title="아직 출시되지 않은 것으로 AI가 판단한 게임">출시 예정</span>}
        </div>
        {game.rating && !game.isDemo && <span className="pill pill-rating">{game.rating}</span>}
        <WishButton game={game} />
      </div>
      <div className="tile-body">
        {evaluation && <MatchSummary evaluation={evaluation} />}
        <h3 className="tile-title">
          <Link to={href} className="stretched-link">
            {game.title}
          </Link>
        </h3>
        {(game.originalTitle || game.releaseDate) && (
          <p className="tile-sub">{[game.originalTitle, game.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ')}</p>
        )}
        {note && <p className="tile-note">{note}</p>}
        <span className="tile-players">{players ? `추천 ${players}` : '인원 정보 없음'}</span>
        {meta && <p className="tile-meta">{meta}</p>}
        <RatingPair global={game.globalRating} member={game.userRating} />
        {evaluation && <MatchBadges evaluation={evaluation} compact />}
      </div>
    </article>
  );
}
