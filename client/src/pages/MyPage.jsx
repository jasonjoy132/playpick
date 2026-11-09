import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { toAvatarDataUrl } from '../lib/image.js';
import { Avatar } from '../components/Avatar.jsx';
import { BadgeIcon, NameBadge, UserBadge } from '../components/Badge.jsx';
import { BadgePicker } from '../components/BadgePicker.jsx';
import { Cover } from '../components/Cover.jsx';
import { RatingBadge, StarsDisplay } from '../components/Stars.jsx';
import { ErrorState, Loading } from '../components/Status.jsx';

const MENU = [
  { group: '내 정보', items: [['profile', '프로필 설정'], ['password', '비밀번호 변경']] },
  { group: '게임', items: [['wishlist', '찜 목록'], ['reviews', '내 리뷰']] },
  { group: '활동', items: [['recent', '최근 본 게임'], ['submissions', '내 제보'], ['badges', '뱃지·칭호']] },
];
const TITLES = Object.fromEntries(MENU.flatMap((m) => m.items));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function MyPage({ section = 'profile', options }) {
  const { user, ready, refreshUser } = useAuth();
  // 마이페이지를 열면 내 정보를 다시 받아 그사이 승인된 제보로 얻은 새 칭호를 알림
  useEffect(() => {
    if (user) refreshUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, user?.id]);
  if (!ready) return <Loading />;
  if (!user) {
    return (
      <div className="state">
        <h1>로그인이 필요해요</h1>
        <p className="muted">마이페이지는 로그인한 뒤 볼 수 있어요.</p>
        <Link to={`/login?next=${encodeURIComponent(`/mypage/${section}`)}`} className="btn btn-gold">
          로그인
        </Link>
      </div>
    );
  }
  if (!TITLES[section]) section = 'profile';
  const content = {
    profile: <ProfileSection />,
    password: <PasswordSection />,
    wishlist: <WishlistSection options={options} />,
    reviews: <ReviewsSection />,
    recent: <RecentSection />,
    submissions: <SubmissionsSection />,
    badges: <BadgesSection />,
  }[section];

  return (
    <div className="mypage">
      <aside className="mypage-nav" aria-label="마이페이지 메뉴">
        <div className="mypage-user">
          <Avatar user={user} size="lg" />
          <div>
            <p className="mypage-name">
              <NameBadge badge={user.badge} size="md" />
              {user.nickname}님
            </p>
            <p className="muted small">{user.loginId}</p>
          </div>
        </div>
        {MENU.map((m) => (
          <nav key={m.group} aria-label={m.group}>
            <p className="mypage-group">{m.group}</p>
            {m.items.map(([key, label]) => (
              <Link key={key} to={`/mypage/${key}`} className={key === section ? 'is-active' : ''} aria-current={key === section ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </aside>
      <section className="mypage-body" aria-labelledby="mypage-title" data-testid={`mypage-${section}`}>
        <h1 id="mypage-title">{TITLES[section]}</h1>
        {content}
      </section>
    </div>
  );
}

function Notice({ state }) {
  if (state?.error) return <p className="form-error" role="alert">{state.error}</p>;
  if (state?.ok) return <p className="form-success" role="status">{state.ok}</p>;
  return null;
}

function ProfileSection() {
  const { user, setUser } = useAuth();
  const [nickname, setNickname] = useState(user.nickname);
  const [nickState, setNickState] = useState(null);
  const [imgState, setImgState] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const saveNick = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNickState(null);
    try {
      const r = await api.updateProfile({ nickname: nickname.trim() });
      setUser(r.user);
      setNickState({ ok: '닉네임을 바꿨어요.' });
    } catch (err) {
      setNickState({ error: err.message });
    } finally {
      setBusy(false);
    }
  };
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setImgState(null);
    try {
      const r = await api.setAvatar(await toAvatarDataUrl(file));
      setUser(r.user);
      setImgState({ ok: '프로필 이미지를 바꿨어요.' });
    } catch (err) {
      setImgState({ error: err.message });
    } finally {
      setBusy(false);
    }
  };
  const removeImg = async () => {
    setBusy(true);
    setImgState(null);
    try {
      setUser((await api.removeAvatar()).user);
      setImgState({ ok: '기본 이미지로 바꿨어요.' });
    } catch (err) {
      setImgState({ error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mypage-cards">
      <div className="panel">
        <h2>프로필 이미지</h2>
        <div className="avatar-edit">
          <Avatar user={user} size="xl" />
          <div className="avatar-actions">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} hidden data-testid="avatar-input" />
            <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              이미지 선택
            </button>
            {user.avatarUrl && (
              <button type="button" className="btn btn-ghost" onClick={removeImg} disabled={busy}>
                기본 이미지로
              </button>
            )}
            <p className="muted small">정사각형으로 잘라 256×256 크기로 저장돼요. 리뷰에 닉네임과 함께 표시됩니다.</p>
          </div>
        </div>
        <Notice state={imgState} />
      </div>
      <form className="panel auth-form" onSubmit={saveNick}>
        <h2>닉네임</h2>
        <div className="form-field">
          <label htmlFor="f-nick">닉네임</label>
          <input id="f-nick" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={12} />
          <p className="field-note">한글·영문·숫자·밑줄 2~12자. 리뷰에 표시돼요.</p>
        </div>
        <Notice state={nickState} />
        <button type="submit" className="btn btn-primary" disabled={busy || nickname.trim() === user.nickname}>
          닉네임 저장
        </button>
        <dl className="info-table compact">
          <div>
            <dt>아이디</dt>
            <dd>{user.loginId}</dd>
          </div>
          <div>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>가입일</dt>
            <dd>{fmtDate(user.createdAt)}</dd>
          </div>
        </dl>
      </form>
    </div>
  );
}

function PasswordSection() {
  const [f, setF] = useState({ current: '', next: '', next2: '' });
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (f.next !== f.next2) return setState({ error: '새 비밀번호 확인이 일치하지 않습니다.' });
    setBusy(true);
    setState(null);
    try {
      await api.changePassword({ currentPassword: f.current, newPassword: f.next });
      setF({ current: '', next: '', next2: '' });
      setState({ ok: '비밀번호를 바꿨어요. 다른 기기에서는 로그아웃되었어요.' });
    } catch (err) {
      setState({ error: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel auth-form narrow" onSubmit={submit} noValidate>
      <div className="form-field">
        <label htmlFor="f-cur">현재 비밀번호</label>
        <input id="f-cur" type="password" value={f.current} onChange={set('current')} autoComplete="current-password" maxLength={64} />
      </div>
      <div className="form-field">
        <label htmlFor="f-new">새 비밀번호</label>
        <input id="f-new" type="password" value={f.next} onChange={set('next')} autoComplete="new-password" maxLength={64} />
        <p className="field-note">영문과 숫자를 포함해 8자 이상</p>
      </div>
      <div className="form-field">
        <label htmlFor="f-new2">새 비밀번호 확인</label>
        <input id="f-new2" type="password" value={f.next2} onChange={set('next2')} autoComplete="new-password" maxLength={64} />
      </div>
      <Notice state={state} />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        비밀번호 변경
      </button>
    </form>
  );
}

function GameRow({ gameId, title, imageUrl, isDemo, children, meta }) {
  return (
    <li className="game-row" data-testid="game-row">
      <Link to={`/games/${encodeURIComponent(gameId)}`} className="game-row-cover" tabIndex={-1} aria-hidden="true">
        <Cover game={{ id: gameId, title, imageUrl }} />
      </Link>
      <div className="game-row-body">
        <Link to={`/games/${encodeURIComponent(gameId)}`} className="game-row-title">
          {title}
        </Link>
        {isDemo && <span className="pill pill-demo">데모</span>}
        {meta}
      </div>
      <div className="game-row-actions">{children}</div>
    </li>
  );
}

export function WishlistSection({ options }) {
  const { refreshWishCount } = useAuth();
  const { status, data, error, retry } = useAsync(() => api.wishlist(), []);
  const [removed, setRemoved] = useState(new Set());
  if (status === 'loading') return <Loading message="찜 목록을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;
  const items = data.items.filter((i) => !removed.has(i.gameId));
  const remove = async (id) => {
    await api.unwish(id);
    setRemoved((s) => new Set([...s, id]));
    refreshWishCount();
  };
  const label = (v) => options?.platforms.find((o) => o.value === v)?.label || v;
  if (!items.length) return <Empty title="아직 찜한 게임이 없어요" desc="게임 카드나 상세 화면의 ♡ 버튼을 눌러 찜해 보세요." testid="wishlist-empty" />;
  return (
    <>
      <p className="muted">{items.length}개 게임</p>
      <ul className="game-rows" data-testid="wishlist">
        {items.map((w) => (
          <GameRow
            key={w.gameId}
            {...w}
            meta={
              <p className="muted small">
                {w.platforms?.map(label).join(', ') || '플랫폼 정보 없음'} · {fmtDate(w.addedAt)}에 찜함 · <RatingBadge rating={w.userRating} />
              </p>
            }
          >
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(w.gameId)}>
              찜 해제
            </button>
          </GameRow>
        ))}
      </ul>
    </>
  );
}

function ReviewsSection() {
  const { status, data, error, retry } = useAsync(() => api.myReviews(), []);
  const [removed, setRemoved] = useState(new Set());
  const [err, setErr] = useState(null);
  if (status === 'loading') return <Loading message="리뷰 내역을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;
  const items = data.items.filter((r) => !removed.has(r.gameId));
  const remove = async (r) => {
    if (!window.confirm(`‘${r.title}’ 리뷰를 삭제할까요? 삭제한 리뷰는 되돌릴 수 없어요.`)) return;
    try {
      await api.deleteReview(r.gameId);
      setRemoved((s) => new Set([...s, r.gameId]));
    } catch (e) {
      setErr(e.message);
    }
  };
  if (!items.length) return <Empty title="아직 남긴 리뷰가 없어요" desc="게임 상세 화면에서 별점과 리뷰를 남길 수 있어요." testid="reviews-empty" />;
  return (
    <>
      <p className="muted">
        {items.length}개 리뷰 · 리뷰는 수정할 수 없고, 삭제한 뒤 다시 작성할 수 있어요.
      </p>
      {err && <p className="form-error">{err}</p>}
      <ul className="game-rows" data-testid="my-reviews">
        {items.map((r) => (
          <GameRow
            key={r.id}
            gameId={r.gameId}
            title={r.title}
            imageUrl={r.imageUrl}
            meta={
              <>
                <p className="review-meta">
                  <StarsDisplay value={r.rating} size="sm" /> <span className="muted small">{fmtDate(r.createdAt)}</span>{r.hidden && <span className="pill pill-warn" title="신고가 접수돼 관리자가 숨긴 리뷰예요. 다른 회원에게 보이지 않아요.">숨김</span>}
                </p>
                {r.content ? <p className="review-body">{r.content}</p> : <p className="muted small">(별점만 남김)</p>}
              </>
            }
          >
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => remove(r)}>
              삭제
            </button>
          </GameRow>
        ))}
      </ul>
    </>
  );
}

function RecentSection() {
  const { status, data, error, retry } = useAsync(() => api.recent(), []);
  const [items, setItems] = useState(null);
  if (status === 'loading') return <Loading message="최근 본 게임을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;
  const list = items ?? data.items;
  const remove = async (id) => setItems((await api.removeRecent(id)).items);
  const clear = async () => {
    if (window.confirm('최근 본 게임 기록을 모두 지울까요?')) setItems((await api.clearRecent()).items);
  };
  if (!list.length) return <Empty title="최근 본 게임이 없어요" desc="게임 상세 화면을 열면 여기에 기록돼요. (최근 30개)" testid="recent-empty" />;
  return (
    <>
      <div className="section-tools">
        <p className="muted">최근 상세 정보를 본 게임 {list.length}개 (최대 30개 저장)</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
          전체 기록 지우기
        </button>
      </div>
      <ul className="game-rows" data-testid="recent">
        {list.map((r) => (
          <GameRow key={r.gameId} {...r} meta={<p className="muted small">{fmtTime(r.viewedAt)}에 봄</p>}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(r.gameId)} aria-label={`${r.title} 기록 삭제`}>
              기록 삭제
            </button>
          </GameRow>
        ))}
      </ul>
    </>
  );
}

const STATUS = {
  pending: ['검토 중', 'pill-wait'],
  approved: ['승인됨', 'pill-ok'],
  rejected: ['거절됨', 'pill-no'],
};

/** 내 제보: 게임·표지 사진·서비스 종료·정보 수정 제보를 한 목록으로 (요약 → 거르기 → 카드) */
const SUB_TYPES = [
  ['game', '게임'],
  ['image', '표지 사진'],
  ['ended', '서비스 종료'],
  ['fix', '정보 수정'],
];
const TYPE_NAME = Object.fromEntries(SUB_TYPES);
const TYPE_ICON = { game: '🎮', image: '🖼', ended: '⛔', fix: '✏️' };
const fmtShort = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const fixText = (f = {}) =>
  [f.players && `추천 인원 ${f.players.min}~${f.players.max}명`, f.hours && `플레이 시간 ${f.hours}시간`, f.storeUrl && '구매처'].filter(Boolean).join(' · ');

/** 세 API 결과 → 같은 모양의 항목 (최신순) */
function toSubItems([games, images, reportsList]) {
  const base = (s) => ({ id: s.id, status: s.status, createdAt: s.createdAt, reviewedAt: s.reviewedAt, rejectReason: s.rejectReason });
  return [
    ...games.items.map((s) => ({
      ...base(s),
      key: `g${s.id}`,
      type: 'game',
      title: s.title,
      link: s.gameId ? `/games/${s.gameId}` : null,
      imageUrl: s.imageUrl,
      what: [s.releaseYear && `${s.releaseYear}년`, s.publisher].filter(Boolean).join(' · ') || '새 게임 추가',
      done: '플레이픽에 게임이 추가됐어요. 고마워요!',
      testid: 'submission-row',
      cancel: () => api.cancelSubmission(s.id),
    })),
    ...images.items.map((s) => ({
      ...base(s),
      key: `p${s.id}`,
      type: 'image',
      title: s.gameTitle,
      link: `/games/${s.gameId}`,
      imageUrl: s.imageUrl,
      what: '게임 표지 사진',
      done: '게임 카드와 상세 화면에 표지로 나와요. 고마워요!',
      testid: 'image-submission-row',
      cancel: () => api.cancelImageSubmission(s.id),
    })),
    ...reportsList.items.map((s) => ({
      ...base(s),
      key: `r${s.id}`,
      type: s.kind === 'ended' ? 'ended' : 'fix',
      title: s.gameTitle,
      link: `/games/${s.gameId}`,
      imageUrl: null,
      what: s.kind === 'ended' ? '서비스가 종료된 게임이에요' : fixText(s.fix) || '게임 정보 수정',
      done: s.kind === 'ended' ? '목록에서 내려졌어요. 고마워요!' : '게임 정보에 반영됐어요. 고마워요!',
      testid: 'report-row',
      cancel: () => api.cancelReport(s.id),
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

const SUB_STATES = [
  ['pending', '검토 중', 'wait'],
  ['approved', '승인', 'ok'],
  ['rejected', '거절', 'no'],
];

function SubGuide() {
  return (
    <aside className="sub-guide" aria-label="제보하는 방법">
      <div>
        <b>플레이픽을 같이 채워 주세요</b>
        <ul>
          <li>
            <span>게임</span> 플레이픽에 없는 게임 → ‘게임 제보하기’
          </li>
          <li>
            <span>표지 사진</span> 사진 없는 게임의 상세 화면 → ‘표지 사진 제보’
          </li>
          <li>
            <span>종료·정보 수정</span> 게임 상세 오른쪽 → ‘정보가 틀렸나요?’
          </li>
        </ul>
      </div>
      <Link to="/submit" className="btn btn-gold btn-sm">
        게임 제보하기
      </Link>
    </aside>
  );
}

function SubmissionsSection() {
  const { status, data, error, retry } = useAsync(() => Promise.all([api.mySubmissions(), api.myImageSubmissions(), api.myReports()]), []);
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [err, setErr] = useState(null);
  if (status === 'loading') return <Loading message="제보 내역을 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;
  const all = toSubItems(data);
  const cancel = async (s) => {
    if (!window.confirm(`‘${s.title}’ ${TYPE_NAME[s.type]} 제보를 취소할까요?`)) return;
    try {
      setErr(null);
      await s.cancel();
      retry();
    } catch (e) {
      setErr(e.message);
    }
  };
  if (!all.length)
    return (
      <>
        <div className="state" data-testid="submissions-empty">
          <h2>아직 제보한 내역이 없어요</h2>
          <p className="muted">관리자가 확인해 승인하면 플레이픽에 반영돼요. 승인·거절되면 알림으로 알려 드려요.</p>
        </div>
        <SubGuide />
      </>
    );
  const ofType = all.filter((s) => !type || s.type === type);
  const items = ofType.filter((s) => !state || s.status === state);
  const reset = () => {
    setType('');
    setState('');
  };
  return (
    <>
      <div className="sub-summary" role="group" aria-label="처리 상태로 거르기">
        {SUB_STATES.map(([st, label, tone]) => (
          <button
            key={st}
            type="button"
            className={`sub-stat tone-${tone}${state === st ? ' is-on' : ''}`}
            aria-pressed={state === st}
            onClick={() => setState((v) => (v === st ? '' : st))}
            data-testid={`sub-stat-${st}`}
          >
            <b>{ofType.filter((s) => s.status === st).length}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="chipbar sub-filter" role="group" aria-label="제보 종류로 거르기">
        {[['', '전체'], ...SUB_TYPES].map(([v, label]) => {
          const n = v ? all.filter((s) => s.type === v).length : all.length;
          return (
            <button
              key={v || 'all'}
              type="button"
              className={`chipbar-item${type === v ? ' is-on' : ''}`}
              aria-pressed={type === v}
              onClick={() => setType(v)}
              disabled={Boolean(v) && !n}
              data-testid={`sub-type-${v || 'all'}`}
            >
              {label} <span className="sub-filter-n">{n}</span>
            </button>
          );
        })}
      </div>
      {err && <p className="form-error">{err}</p>}
      {items.length === 0 ? (
        <div className="state" data-testid="submissions-filter-empty">
          <h2>조건에 맞는 제보가 없어요</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            전체 보기
          </button>
        </div>
      ) : (
        <ul className="sub-list" data-testid="my-submissions">
          {items.map((s) => {
            const [name, cls] = STATUS[s.status];
            return (
              <li key={s.key} className={`sub-card is-${s.status}`} data-testid={s.testid}>
                <div className="sub-cover">
                  {s.imageUrl ? (
                    <Cover game={{ id: s.key, title: s.title, imageUrl: s.imageUrl }} />
                  ) : (
                    <span className="sub-cover-icon" aria-hidden="true">
                      {TYPE_ICON[s.type]}
                    </span>
                  )}
                </div>
                <div className="sub-main">
                  <p className="sub-top">
                    <span className="sub-type">{TYPE_NAME[s.type]}</span>
                    <span className={`pill ${cls}`}>{name}</span>
                  </p>
                  <h3 className="sub-title">{s.link ? <Link to={s.link}>{s.title}</Link> : s.title}</h3>
                  <p className="sub-what">{s.what}</p>
                  <p className="sub-time">
                    {fmtShort(s.createdAt)} 제보
                    {s.reviewedAt ? ` → ${fmtShort(s.reviewedAt)} ${s.status === 'approved' ? '승인' : '처리'}` : ' · 관리자 확인 중'}
                  </p>
                  {s.status === 'rejected' && s.rejectReason && (
                    <p className="sub-reason">
                      <b>거절 사유</b> {s.rejectReason}
                    </p>
                  )}
                  {s.status === 'approved' && <p className="sub-done">{s.done}</p>}
                </div>
                {s.status === 'pending' && (
                  <button type="button" className="btn btn-ghost btn-sm danger sub-cancel" onClick={() => cancel(s)}>
                    제보 취소
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SubGuide />
    </>
  );
}

/** 뱃지·칭호: 받은 뱃지, 진행도, 대표 칭호 고르기 */
function BadgesSection() {
  const { setUser } = useAuth();
  const { status, data, error, retry } = useAsync(() => api.myBadges(), []);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  if (status === 'loading') return <Loading message="뱃지를 불러오는 중이에요…" />;
  if (status === 'error') return <ErrorState error={error} onRetry={retry} />;
  const choose = async (id) => {
    setBusy(true);
    setState(null);
    try {
      const r = await api.selectBadge(id);
      setUser((u) => (u ? { ...u, badge: r.display } : u));
      setState({ ok: id ? '대표 칭호를 바꿨어요.' : '가장 높은 단계 칭호를 자동으로 달아요.' });
      retry();
    } catch (e) {
      setState({ error: e.message });
    } finally {
      setBusy(false);
    }
  };
  const tiers = data.badges.filter((b) => b.kind === 'tier' && b.track === 'submit');
  const reviewTiers = data.badges.filter((b) => b.kind === 'tier' && b.track === 'review');
  const photoTiers = data.badges.filter((b) => b.kind === 'tier' && b.track === 'photo');
  const infoTiers = data.badges.filter((b) => b.kind === 'tier' && b.track === 'info');
  const specials = data.badges.filter((b) => b.kind === 'special');
  const card = (b) => {
    const on = data.selected === b.id || (!data.selected && data.display?.id === b.id);
    return (
      <li key={b.id} className={`badge-card${b.earned ? ' is-earned' : ''}${on ? ' is-on' : ''}`} data-testid={`badge-${b.id}`}>
        <div className="badge-medal" aria-hidden="true">
          <BadgeIcon badge={b} className="badge-medal-icon" />
        </div>
        <div className="badge-info">
          <p className="badge-name">
            {b.name} {on && <span className="pill pill-ok">대표</span>}
          </p>
          <p className="muted small">{b.desc}</p>
          {!b.earned && (
            <div className="badge-progress" role="progressbar" aria-valuemin={0} aria-valuemax={b.need} aria-valuenow={b.have} aria-label={`${b.name} 진행도`}>
              <span style={{ width: `${(b.have / b.need) * 100}%` }} />
              <em>
                {b.have} / {b.need}
              </em>
            </div>
          )}
          {b.earned && !on && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => choose(b.id)}>
              대표 칭호로 달기
            </button>
          )}
        </div>
      </li>
    );
  };
  return (
    <>
      <div className="badge-hero panel">
        <p className="muted small">지금 닉네임 앞에 달린 뱃지 (칭호 이름은 마우스를 올리면 보여요)</p>
        {data.display ? <UserBadge badge={data.display} size="lg" /> : <p>아직 칭호가 없어요. 리뷰를 남기거나 게임을 제보해서 첫 칭호를 받아 보세요!</p>}
        {data.next && (
          <p className="small">
            제보 승인 <b>{data.next.need - data.next.have}개</b> 더 받으면 <UserBadge badge={data.next} /> 칭호를 받아요.
          </p>
        )}
        {data.nextReview && (
          <p className="small" data-testid="next-review">
            리뷰 <b>{data.nextReview.need - data.nextReview.have}개</b> 더 쓰면 <UserBadge badge={data.nextReview} /> 칭호를 받아요.
          </p>
        )}
        {data.nextPhoto && (
          <p className="small" data-testid="next-photo">
            표지 사진 제보 <b>{data.nextPhoto.need - data.nextPhoto.have}개</b>가 더 승인되면 <UserBadge badge={data.nextPhoto} /> 칭호를 받아요.
          </p>
        )}
        {data.nextInfo && (
          <p className="small" data-testid="next-info">
            서비스 종료·정보 수정 제보 <b>{data.nextInfo.need - data.nextInfo.have}개</b>가 더 승인되면 <UserBadge badge={data.nextInfo} /> 칭호를 받아요.
          </p>
        )}
        <div className="form-actions">
          <Link to="/submit" className="btn btn-gold btn-sm">
            게임 제보하기
          </Link>
          {data.selected && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => choose(null)}>
              자동(가장 높은 단계)으로
            </button>
          )}
        </div>
        <Notice state={state} />
      </div>
      <h2 className="badge-group">대표 칭호 고르기</h2>
      <p className="muted small">받은 칭호 중 마음에 드는 것을 눌러 닉네임 앞에 달 수 있어요. ‘자동’은 가장 높은 단계 칭호를 달아요.</p>
      <BadgePicker data={data} onChanged={() => {
          setState({ ok: '대표 칭호를 바꿨어요.' });
          retry();
        }} />
      <h2 className="badge-group">제보 칭호 · 승인된 제보 수</h2>
      <ul className="badge-grid">{tiers.map(card)}</ul>
      <h2 className="badge-group">리뷰 칭호 · 리뷰를 남긴 게임 수</h2>
      <ul className="badge-grid">{reviewTiers.map(card)}</ul>
      <h2 className="badge-group">사진 칭호 · 승인된 표지 사진 제보 수</h2>
      <p className="muted small">사진이 없는 게임의 상세 화면에서 ‘표지 사진 제보’로 올릴 수 있어요.</p>
      <ul className="badge-grid">{photoTiers.map(card)}</ul>
      <h2 className="badge-group">정보 칭호 · 승인된 서비스 종료·정보 수정 제보 수</h2>
      <p className="muted small">게임 상세 화면 오른쪽 ‘정보가 틀렸나요?’에서 제보할 수 있어요.</p>
      <ul className="badge-grid">{infoTiers.map(card)}</ul>
      <h2 className="badge-group">특별 뱃지</h2>
      <ul className="badge-grid">{specials.map(card)}</ul>
      <p className="muted small">제보는 관리자가 승인한 것만 세요. 승인된 게임이 내려지거나 리뷰를 지우면 개수에서 빠져요.</p>
    </>
  );
}

function Empty({ title, desc, testid }) {
  return (
    <div className="state" data-testid={testid}>
      <h2>{title}</h2>
      <p className="muted">{desc}</p>
      <Link to="/" className="btn btn-primary">
        게임 둘러보기
      </Link>
    </div>
  );
}
