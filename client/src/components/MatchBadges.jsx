const TEXT = {
  match: { icon: '✓', suffix: '일치' },
  mismatch: { icon: '✕', suffix: '불일치' },
  unknown: { icon: '?', suffix: '정보 없음' },
};

export function MatchBadges({ evaluation, compact = false }) {
  if (!evaluation) return null;
  return (
    <ul className={`match-badges${compact ? ' is-compact' : ''}`} aria-label="조건 일치 여부">
      {evaluation.checks.map((c) => {
        const t = TEXT[c.status];
        return (
          <li key={c.key} className={`match-badge is-${c.status}`} data-status={c.status} data-key={c.key}>
            <span aria-hidden="true">{t.icon}</span> {c.label} {t.suffix}
            {!compact && c.status === 'match' && c.matched?.length ? <span className="match-detail"> ({c.matched.join(', ')})</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function MatchSummary({ evaluation }) {
  if (!evaluation) return null;
  const { matchedCount, totalCount, isFullMatch } = evaluation;
  return (
    <span className={`match-summary ${isFullMatch ? 'is-full' : 'is-partial'}`}>
      {isFullMatch ? '모든 조건 일치' : `${totalCount}개 조건 중 ${matchedCount}개 일치`}
    </span>
  );
}
