// 대표 칭호 고르기: 받은 칭호 중 마음에 드는 것을 눌러 닉네임 앞에 달기 ('자동'은 가장 높은 단계)
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { BadgeIcon } from './Badge.jsx';

/**
 * @param {{ data: { badges: any[], selected: string|null, display: any }, onChanged?: () => void, compact?: boolean }} props
 *  data: GET /api/me/badges 결과
 */
export function BadgePicker({ data, onChanged, compact = false }) {
  const { setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const earned = data.badges.filter((b) => b.earned);
  if (!earned.length) return null;
  const current = data.selected; // null 이면 자동
  const choose = async (id) => {
    if (busy || id === current) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.selectBadge(id);
      setUser((u) => (u ? { ...u, badge: r.display } : u));
      onChanged?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`badge-picker${compact ? ' is-compact' : ''}`} data-testid="badge-picker">
      <div className="badge-picker-list" role="radiogroup" aria-label="대표 칭호 고르기">
        <button
          type="button" role="radio" aria-checked={current == null} className={`badge-pick badge-pick-auto${current == null ? ' is-on' : ''}`}
          onClick={() => choose(null)} disabled={busy} title="가장 높은 단계 칭호를 자동으로 달아요" data-testid="pick-auto"
        >
          자동
        </button>
        {earned.map((b) => (
          <button
            key={b.id} type="button" role="radio" aria-checked={current === b.id} className={`badge-pick${current === b.id ? ' is-on' : ''}`}
            onClick={() => choose(b.id)} disabled={busy} title={b.name} aria-label={b.name} data-testid={`pick-${b.id}`}
          >
            <BadgeIcon badge={b} className="badge-pick-icon" />
            {!compact && <span className="badge-pick-name">{b.name}</span>}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
