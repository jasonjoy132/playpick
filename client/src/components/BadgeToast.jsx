// 새 칭호 알림: 새로 받은 뱃지가 있으면 화면 오른쪽 아래에 축하 카드를 띄움
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { BadgeIcon } from './Badge.jsx';

/** 여러 개면 단계가 높은 칭호를 크게 보여 줌 */
const rank = (b) => (b.kind === 'tier' ? b.tier * 10 : 5);

export function BadgeToast() {
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const list = user?.newBadges ?? [];
  if (!list.length) return null;
  const main = [...list].sort((a, b) => rank(b) - rank(a))[0];
  const others = list.filter((b) => b.id !== main.id);

  const done = async (selectId) => {
    setBusy(true);
    try {
      let badge = user.badge;
      if (selectId) badge = (await api.selectBadge(selectId)).display;
      await api.markBadgesSeen(list.map((b) => b.id));
      setUser((u) => (u ? { ...u, newBadges: [], badge } : u));
    } catch {
      setUser((u) => (u ? { ...u, newBadges: [] } : u)); // 실패해도 이번엔 닫고, 다음에 다시 알림
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="badge-toast" role="dialog" aria-live="polite" aria-labelledby="badge-toast-title" data-testid="badge-toast">
      <div className="badge-toast-burst" aria-hidden="true" />
      <BadgeIcon badge={main} className="badge-toast-icon" />
      <div className="badge-toast-body">
        <p className="badge-toast-kicker">🎉 새 칭호를 얻었어요!</p>
        <h2 id="badge-toast-title">{main.name}</h2>
        <p className="muted small">{main.desc}</p>
        {others.length > 0 && (
          <p className="badge-toast-more small">
            {others.map((b) => (
              <span key={b.id} title={b.name} className="badge-toast-mini">
                <BadgeIcon badge={b} className="badge-toast-mini-icon" />
                {b.name}
              </span>
            ))}
            도 받았어요
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-gold btn-sm" disabled={busy} onClick={() => done(main.id)} data-testid="badge-toast-equip">
            대표 칭호로 달기
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => done(null)} data-testid="badge-toast-close">
            확인
          </button>
          <Link to="/mypage/badges" className="small badge-toast-link" onClick={() => done(null)}>
            모든 뱃지 보기
          </Link>
        </div>
      </div>
    </div>
  );
}
