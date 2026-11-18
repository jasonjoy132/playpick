// 표지 이미지. 실제 이미지가 없으면 (만들어 낸 그림이 아닌) 단색 자리표시 + '이미지 없음'
// 사이트 색(흰·검정 + 파랑 하나)에 맞게 차분한 파랑 계열 안에서만 조금씩 다르게(보라·초록 빼기)
const HUES = [200, 206, 212, 218, 203, 209, 215, 221];

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
