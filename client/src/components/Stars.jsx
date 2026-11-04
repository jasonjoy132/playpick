// 별점 표시 / 입력
export function StarsDisplay({ value, size = 'md' }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <span className={`stars stars-${size}`} role="img" aria-label={`5점 만점에 ${v}점`}>
      <span className="stars-bg">★★★★★</span>
      <span className="stars-fg" style={{ width: `${(v / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

/** 플레이픽 회원 평점 */
export function RatingBadge({ rating, label = '회원' }) {
  if (!rating?.count) return <span className="rating-badge is-empty">{label} 평점 없음</span>;
  return (
    <span className="rating-badge" aria-label={`${label} 평점 5점 만점에 ${rating.avg}점, ${rating.count}명 평가`}>
      <span className="rating-kind">{label}</span>
      <span aria-hidden="true">★</span> {rating.avg.toFixed(1)} <span className="muted">({rating.count})</span>
    </span>
  );
}

/** 글로벌 평점 (IGDB 100점 만점 → 5점 만점) */
export function GlobalBadge({ rating }) {
  if (!rating?.count) return null;
  return (
    <span className="rating-badge is-global" aria-label={`글로벌 평점 5점 만점에 ${rating.avg}점, IGDB ${rating.count}명 평가`}>
      <span className="rating-kind">글로벌</span>
      <span aria-hidden="true">★</span> {rating.avg.toFixed(1)}
    </span>
  );
}

/** 카드용: 글로벌·회원 평점 한 줄 */
export function RatingPair({ global, member }) {
  return (
    <span className="rating-pair">
      <GlobalBadge rating={global} />
      <RatingBadge rating={member} />
    </span>
  );
}

export function StarsInput({ value, onChange, name = 'rating' }) {
  return (
    <fieldset className="stars-input">
      <legend className="sr-only">별점</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={n <= value ? 'is-on' : ''}>
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
          <span aria-hidden="true">★</span>
          <span className="sr-only">{n}점</span>
        </label>
      ))}
    </fieldset>
  );
}
