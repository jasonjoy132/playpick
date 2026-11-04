import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Link, useLocation } from '../lib/router.jsx';
import { StarsDisplay, StarsInput } from './Stars.jsx';
import { Avatar } from './Avatar.jsx';
import { NameBadge } from './Badge.jsx';

const fmt = (iso) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

/** 유저 별점(5점 만점 평균)과 리뷰 */
export function Reviews({ gameId, onStats, globalRating, isIgdb }) {
  const { user, setUser } = useAuth();
  // 리뷰를 쓰거나 지우면 칭호가 바뀔 수 있어 내 정보(뱃지)를 다시 받음
  const refreshBadge = () => api.me().then((r) => r.user && setUser(r.user)).catch(() => {});
  const { pathname, search } = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ rating: 0, content: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [more, setMore] = useState({ loading: false, done: false });

  const apply = (d) => {
    setData(d);
    onStats?.(d.stats);
    setMore({ loading: false, done: d.reviews.length < 20 });
  };
  const load = () =>
    api
      .reviews(gameId)
      .then(apply)
      .catch((e) => setError(e.message));
  useEffect(() => {
    setData(null);
    setError(null);
    setEditing(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, user?.id]);

  const mine = data?.reviews.find((r) => r.mine);
  const startEdit = () => {
    setForm({ rating: 0, content: '' });
    setFormError(null);
    setEditing(true);
  };
  const save = async (e) => {
    e.preventDefault();
    if (!form.rating) return setFormError('별점을 선택해 주세요.');
    setBusy(true);
    setFormError(null);
    try {
      apply(await api.saveReview(gameId, form));
      refreshBadge();
      setEditing(false);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm('내 리뷰를 삭제할까요? 삭제한 리뷰는 되돌릴 수 없어요.')) return;
    setBusy(true);
    try {
      apply(await api.deleteReview(gameId));
      refreshBadge();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const loadMore = async () => {
    setMore({ loading: true, done: false });
    try {
      const d = await api.reviews(gameId, data.reviews.length);
      setData((x) => ({ ...x, reviews: [...x.reviews, ...d.reviews.filter((r) => !x.reviews.some((y) => y.id === r.id))] }));
      setMore({ loading: false, done: d.reviews.length < 20 });
    } catch {
      setMore({ loading: false, done: false });
    }
  };

  return (
    <section className="panel reviews" aria-labelledby="reviews-title" data-testid="reviews">
      <h2 id="reviews-title">평점 · 리뷰</h2>
      {error && <p className="form-error">{error}</p>}
      {!data && !error && <p className="muted">불러오는 중…</p>}
      {data && (
        <>
          <RatingCompare global={globalRating} member={data.stats} isIgdb={isIgdb} />

          {!user ? (
            <p className="review-login">
              <Link to={`/login?next=${encodeURIComponent(pathname + search)}`}>로그인</Link>하고 별점과 리뷰를 남겨 보세요.
            </p>
          ) : editing ? (
            <form className="review-form" onSubmit={save} data-testid="review-form">
              <StarsInput value={form.rating} onChange={(rating) => setForm((f) => ({ ...f, rating }))} />
              <label className="sr-only" htmlFor="review-text">
                리뷰 내용
              </label>
              <textarea
                id="review-text"
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                maxLength={1000}
                rows={4}
                placeholder="게임은 어땠나요? 함께 플레이한 인원, 좋았던 점 등을 자유롭게 남겨 주세요. (선택, 1000자 이내)"
              />
              <p className="muted small">등록한 리뷰는 수정할 수 없어요. (삭제 후 다시 작성 가능)</p>
              <div className="review-form-foot">
                <span className="muted small">{form.content.length} / 1000</span>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                    취소
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    등록하기
                  </button>
                </div>
              </div>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
            </form>
          ) : (
            mine ? (
            <p className="muted small review-mine-note">이 게임에 리뷰를 남겼어요. 리뷰는 수정할 수 없고, 아래 내 리뷰의 ‘삭제’로 지운 뒤 다시 작성할 수 있어요.</p>
            ) : (
            <div className="review-cta">
              <button type="button" className="btn btn-primary" onClick={startEdit} data-testid="write-review">
                별점·리뷰 남기기
              </button>
            </div>
            )
          )}

          <ul className="review-list">
            {data.reviews.map((r) => (
              <li key={r.id} className={r.mine ? 'is-mine' : ''} data-testid="review-item">
                <div className="review-head">
                  <Avatar user={{ nickname: r.nickname, avatarUrl: r.avatarUrl }} size="sm" />
                  <span className="nick">
                    <NameBadge badge={r.badge} />
                    <b>{r.nickname}</b>
                  </span>
                  {r.mine && <span className="pill pill-light">내 리뷰</span>}
                  <StarsDisplay value={r.rating} size="sm" />
                  <span className="muted small">
                    {fmt(r.createdAt)}
                  </span>
                </div>
                {r.hidden && <p className="notice small" data-testid="review-hidden">신고가 접수돼 관리자가 이 리뷰를 숨겼어요. 다른 회원에게는 보이지 않아요.</p>}
                {r.content && <p className="review-body">{r.content}</p>}
                {r.mine ? (
                  <div className="review-foot">
                    <button type="button" className="review-delete" onClick={remove} disabled={busy} data-testid="delete-review">
                      삭제
                    </button>
                  </div>
                ) : (
                  user && <ReportReview review={r} onDone={() => setData((x) => ({ ...x, reviews: x.reviews.map((y) => (y.id === r.id ? { ...y, reported: true } : y)) }))} />
                )}
              </li>
            ))}
          </ul>
          {data.reviews.length >= 20 && !more.done && (
            <div className="more">
              <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={more.loading}>
                리뷰 더 보기
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 글로벌 평점(IGDB)과 플레이픽 회원 평점 비교 */
function RatingCompare({ global, member, isIgdb }) {
  const diff = global?.count && member.count ? Math.round((member.avg - global.avg) * 10) / 10 : null;
  let verdict = null;
  if (diff != null) {
    if (Math.abs(diff) < 0.25) verdict = '회원 평점과 글로벌 평점이 비슷해요.';
    else verdict = `플레이픽 회원들은 글로벌보다 ${Math.abs(diff).toFixed(1)}점 ${diff > 0 ? '더 높게' : '더 낮게'} 평가했어요.`;
  }
  return (
    <div className="rating-compare" data-testid="rating-compare">
      <div className="rating-card is-global">
        <p className="rating-card-title">글로벌 평점</p>
        {global?.count ? (
          <>
            <div className="rating-big">
              <strong data-testid="global-avg">{global.avg.toFixed(1)}</strong>
              <span className="muted">/ 5</span>
            </div>
            <StarsDisplay value={global.avg} size="lg" />
            <p className="muted small">IGDB {global.count.toLocaleString('ko-KR')}개 평가 기준 (100점 만점을 5점으로 환산)</p>
            {(global.users || global.critics) && (
              <ul className="rating-parts">
                {global.users && (
                  <li>
                    IGDB 이용자 <b>{global.users.avg.toFixed(1)}</b> <span className="muted">({global.users.count.toLocaleString('ko-KR')})</span>
                  </li>
                )}
                {global.critics && (
                  <li>
                    평론가 <b>{global.critics.avg.toFixed(1)}</b> <span className="muted">({global.critics.count.toLocaleString('ko-KR')})</span>
                  </li>
                )}
              </ul>
            )}
          </>
        ) : (
          <p className="muted small rating-none">{isIgdb ? 'IGDB에 아직 평가가 없어요.' : '이 게임은 IGDB 데이터가 없어 글로벌 평점이 없어요.'}</p>
        )}
      </div>
      <div className="rating-card is-member">
        <p className="rating-card-title">플레이픽 회원 평점</p>
        <div className="rating-big">
          <strong data-testid="rating-avg">{member.avg != null ? member.avg.toFixed(1) : '–'}</strong>
          <span className="muted">/ 5</span>
        </div>
        <StarsDisplay value={member.avg ?? 0} size="lg" />
        <p className="muted small">{member.count ? `회원 ${member.count}명 평가` : '아직 평가가 없어요. 첫 리뷰를 남겨 보세요!'}</p>
        {member.count > 0 && (
          <ul className="rating-dist" aria-label="회원 별점 분포">
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                <span>{n}점</span>
                <span className="bar">
                  <span style={{ width: `${(member.distribution[n] / member.count) * 100}%` }} />
                </span>
                <span className="muted">{member.distribution[n]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {verdict && (
        <p className="rating-verdict" data-testid="rating-verdict">
          {verdict}
        </p>
      )}
    </div>
  );
}

const REASONS = [
  ['abuse', '욕설·비방'],
  ['spam', '광고·도배'],
  ['spoiler', '스포일러'],
  ['offtopic', '게임과 관련 없음'],
  ['other', '기타'],
];

/** 다른 회원 리뷰 신고 (오른쪽 아래 작은 버튼 → 사유 고르기) */
function ReportReview({ review, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState({});
  if (review.reported) {
    return (
      <div className="review-foot">
        <span className="muted small" data-testid="review-reported">
          신고했어요
        </span>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="review-foot">
        <button type="button" className="review-delete" onClick={() => setOpen(true)} data-testid="report-review">
          신고
        </button>
      </div>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api.reportReview(review.id, { reason, note });
      onDone();
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <form className="report-review" onSubmit={submit} data-testid="report-review-form">
      <p className="small">
        <b>이 리뷰를 신고할까요?</b> 관리자가 확인한 뒤 숨길 수 있어요.
      </p>
      <div className="chip-row" role="radiogroup" aria-label="신고 사유">
        {REASONS.map(([v, label]) => (
          <label key={v} className="chip">
            <input type="radio" name={`reason-${review.id}`} value={v} checked={reason === v} onChange={() => setReason(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <input type="text" className="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="자세한 내용 (선택)" aria-label="자세한 내용" />
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={state.busy}>
          취소
        </button>
        <button type="submit" className="btn btn-danger btn-sm" disabled={state.busy || !reason} data-testid="submit-review-report">
          신고하기
        </button>
      </div>
    </form>
  );
}
