// 명예 뱃지·칭호 (게임 제보·리뷰 실적). 닉네임 옆에 달아 돋보이게 표시
import { useState } from 'react';

/** 뱃지 그림 (그림을 못 불러오면 이모지로 대신) */
export function BadgeIcon({ badge, className = 'ubadge-icon' }) {
  const [broken, setBroken] = useState(false);
  if (badge.image && !broken) {
    return <img className={`${className} ubadge-img`} src={badge.image} alt="" aria-hidden="true" loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <span className={className} aria-hidden="true">
      {badge.icon}
    </span>
  );
}

/** 닉네임 앞에 붙는 뱃지 그림만 (칭호 이름은 마우스를 올리면 보임) */
export function NameBadge({ badge, size = 'sm' }) {
  if (!badge) return null;
  return (
    <span className={`name-badge name-badge-${size}`} title={badge.name} role="img" aria-label={`칭호: ${badge.name}`} data-testid="name-badge">
      <BadgeIcon badge={badge} className="name-badge-icon" />
    </span>
  );
}

export function UserBadge({ badge, size = 'sm', showName = true }) {
  if (!badge) return null;
  const tone = badge.kind === 'tier' ? `t${badge.tier}` : 'sp';
  return (
    <span className={`ubadge ubadge-${tone} ubadge-${size}`} title={`칭호: ${badge.name}`} data-testid="user-badge">
      <BadgeIcon badge={badge} />
      {showName && <span className="ubadge-name">{badge.name}</span>}
    </span>
  );
}
