import { useState } from 'react';
import { Link, navigate } from '../lib/router.jsx';
import { useAuth } from '../lib/auth.jsx';
import { LogoMark } from './Logo.jsx';
import { Avatar } from './Avatar.jsx';
import { BadgeIcon, NameBadge } from './Badge.jsx';
import { BadgePicker } from './BadgePicker.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';

/** 로그인 창 (첫 화면 오른쪽 위 / 로그인 페이지 공통) */
export function LoginPanel({ next, compact = false }) {
  const { login } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!loginId.trim() || !password) return setError('아이디와 비밀번호를 입력해 주세요.');
    setBusy(true);
    setError(null);
    try {
      await login(loginId.trim(), password);
      setPassword('');
      if (next) navigate(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`login-panel${compact ? ' is-compact' : ''}`} aria-labelledby="login-title" data-testid="login-panel">
      <header className="login-head">
        <h2 id="login-title">로그인</h2>
        <span className="login-brand" aria-hidden="true">
          <LogoMark size={22} /> PlayPick
        </span>
      </header>
      <form onSubmit={submit} noValidate>
        <label className="input-icon">
          <span className="sr-only">아이디</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v1.5h16V19c0-2.8-3.6-5-8-5z" /></svg>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="아이디" autoComplete="username" name="loginId" maxLength={20} />
        </label>
        <label className="input-icon">
          <span className="sr-only">비밀번호</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zm-8 0V7a3 3 0 0 1 6 0v2H9z" /></svg>
          <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" autoComplete="current-password" name="password" maxLength={64} />
          <button type="button" className="eye" onClick={() => setShow((v) => !v)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'} aria-pressed={show}>
            {show ? '숨김' : '보기'}
          </button>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-gold btn-block" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
      <nav className="login-links" aria-label="계정 도움말">
        <Link to="/find-id">아이디 찾기</Link>
        <Link to="/find-password">비밀번호 찾기</Link>
        <Link to="/signup">회원가입</Link>
      </nav>
    </section>
  );
}

/** 로그인한 사용자 요약 (첫 화면 오른쪽 위) */
export function ProfilePanel() {
  const { user, logout, wishCount } = useAuth();
  // 칭호·업적: 대표 칭호가 바뀌거나 새 칭호 알림이 오면 다시 받음
  const info = useAsync(() => api.myBadges(), [user.id, user.badge?.id, (user.newBadges ?? []).map((b) => b.id).join()]);
  const b = info.data;
  const [picking, setPicking] = useState(false);
  const earned = b ? b.badges.filter((x) => x.earned) : [];
  // 다음 목표: 제보·리뷰·사진 단계 중 가까운(남은 수가 적은) 것 2개
  const goals = b ? [b.nextReview && { ...b.nextReview, label: '리뷰' }, b.next && { ...b.next, label: '제보 승인' }, b.nextPhoto && { ...b.nextPhoto, label: '사진 제보 승인' }, b.nextInfo && { ...b.nextInfo, label: '정보 제보 승인' }].filter(Boolean).sort((x, y) => x.need - x.have - (y.need - y.have)).slice(0, 2) : [];
  return (
    <section className="login-panel profile-panel" aria-label="내 계정" data-testid="profile-panel">
      <header className="pp-head">
        <Avatar user={user} size="lg" />
        <div className="pp-who">
          <p className="profile-name">
            <NameBadge badge={user.badge} size="md" />
            {user.nickname}님
          </p>
          <p className="profile-id">{user.loginId}</p>
        </div>
        <Link to="/mypage/profile" className="pp-gear" aria-label="마이페이지" title="마이페이지">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
        </Link>
      </header>

      <div className="pp-stats">
        <Link to="/mypage/wishlist" className="pp-stat" data-testid="pp-wish">
          <b>{wishCount ?? '–'}</b>
          <span>찜</span>
        </Link>
        <Link to="/mypage/reviews" className="pp-stat" data-testid="pp-reviews">
          <b>{b ? b.stats.reviews : '–'}</b>
          <span>리뷰</span>
        </Link>
        <Link to="/mypage/submissions" className="pp-stat">
          <b>{b ? b.stats.approved : '–'}</b>
          <span>제보 승인</span>
        </Link>
      </div>

      <Link to="/mypage/badges" className="pp-title" data-testid="pp-title">
        <span className="pp-title-main">
          {b?.display && <BadgeIcon badge={b.display} className="pp-title-icon" />}
          <span className="pp-title-text">
            <small>{b?.display ? (b.selected ? '대표 칭호' : '대표 칭호 · 자동') : '대표 칭호'}</small>
            <b>{b?.display ? b.display.name : '아직 칭호가 없어요'}</b>
          </span>
        </span>
        {earned.length > 0 && (
          <span className="pp-shelf" aria-label={`보유한 칭호 ${earned.length}개`}>
            {earned.slice(0, 7).map((x) => (
              <span key={x.id} title={x.name} className="pp-shelf-item">
                <BadgeIcon badge={x} className="pp-shelf-icon" />
              </span>
            ))}
            {earned.length > 7 && <span className="pp-shelf-more">+{earned.length - 7}</span>}
            <span className="pp-owned">
              보유 <b>{b.earnedCount}</b>/{b.totalCount}
            </span>
          </span>
        )}
      </Link>
      {earned.length > 0 && (
        <div className="pp-pick">
          <button type="button" className="link-btn small" onClick={() => setPicking((v) => !v)} aria-expanded={picking} data-testid="pp-pick-toggle">
            {picking ? '닫기' : '대표 칭호 바꾸기'}
          </button>
          {picking && <BadgePicker data={b} compact onChanged={() => info.retry()} />}
        </div>
      )}

      {goals.length > 0 && (
        <div className="pp-block" data-testid="pp-goals">
          <p className="pp-label">다음 칭호까지</p>
          {goals.map((g) => (
            <div key={g.id} className="pp-goal">
              <BadgeIcon badge={g} className="pp-goal-icon" />
              <div className="pp-goal-body">
                <p>
                  {g.label} <b>{g.need - g.have}개</b> 더 → <b>{g.name}</b>
                </p>
                <div className="pp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={g.need} aria-valuenow={g.have} aria-label={`${g.name} 진행도`}>
                  <span style={{ width: `${Math.min(100, (g.have / g.need) * 100)}%` }} />
                </div>
              </div>
              <span className="pp-goal-num">
                {g.have}/{g.need}
              </span>
            </div>
          ))}
        </div>
      )}

      {b?.recent?.length > 0 && (
        <div className="pp-block" data-testid="pp-recent">
          <p className="pp-label">최근 획득한 업적</p>
          <ul className="pp-recent">
            {b.recent.map((x) => (
              <li key={x.id} title={x.name}>
                <BadgeIcon badge={x} className="pp-recent-icon" />
                <span>{x.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pp-foot">
        <Link to="/mypage/recent">최근 본 게임</Link>
        <Link to="/submit">게임 제보</Link>
        <button type="button" onClick={logout} data-testid="logout">
          로그아웃
        </button>
      </div>
    </section>
  );
}
