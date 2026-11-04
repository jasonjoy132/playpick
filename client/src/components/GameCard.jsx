import { Link } from '../lib/router.jsx';
import { formatList, formatPlayers, NO_INFO } from '../lib/format.js';
import { MatchBadges, MatchSummary } from './MatchBadges.jsx';

export function GameCard({ game, evaluation, options, search }) {
  const href = `/games/${encodeURIComponent(game.id)}${search ? `?${search}` : ''}`;
  return (
    <article className="game-card" data-testid="game-card" data-game-id={game.id}>
      {game.imageUrl && <img className="game-cover" src={game.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <div className="game-card-top">
        <MatchSummary evaluation={evaluation} />
        <span className="card-tags">
          {game.isDemo && <span className="tag tag-demo">데모</span>}
          {game.rating && !game.isDemo && <span className="tag">{game.rating}</span>}
          {game.source === '게임물관리위원회' && <span className="tag">게임위</span>}
        </span>
      </div>
      <h3 className="game-title">
        <Link to={href} className="stretched-link">
          {game.title}
        </Link>
      </h3>
      {game.originalTitle && <p className="game-original">{game.originalTitle}</p>}
      <p className="game-publisher">{game.publisher || `업체 ${NO_INFO}`}</p>
      <p className="game-summary">{game.summary || `게임 소개 ${NO_INFO}`}</p>
      <dl className="game-facts">
        <div>
          <dt>인원</dt>
          <dd>{formatPlayers(game.players)}</dd>
        </div>
        <div>
          <dt>플랫폼</dt>
          <dd>{formatList(game.platforms, game.platformsRaw, options?.platforms)}</dd>
        </div>
        <div>
          <dt>장르</dt>
          <dd>{formatList(game.genres, game.genresRaw, options?.genres)}</dd>
        </div>
      </dl>
      <MatchBadges evaluation={evaluation} />
      <span className="card-cta" aria-hidden="true">
        상세 보기 →
      </span>
    </article>
  );
}
