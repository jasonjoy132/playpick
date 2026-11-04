// 표지 이미지. 실제 이미지가 없으면 (만들어 낸 그림이 아닌) 단색 자리표시 + '이미지 없음'
const HUES = [200, 170, 220, 260, 190, 150, 280, 210];

export function Cover({ game, className = '' }) {
  if (game.imageUrl) {
    return <img className={`cover ${className}`} src={game.imageUrl} alt={`${game.title} 표지`} loading="lazy" referrerPolicy="no-referrer" />;
  }
  const n = [...String(game.id)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const h = HUES[n % HUES.length];
  return (
    <div className={`cover cover-empty ${className}`} style={{ '--h': h }} role="img" aria-label={`${game.title} (이미지 없음)`}>
      <span className="cover-empty-title">{game.title}</span>
      <span className="cover-empty-note">이미지 없음</span>
    </div>
  );
}
