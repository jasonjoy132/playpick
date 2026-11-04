// 관리자: 게임·표지 사진·서비스 종료·정보 수정 제보 검토, 리뷰 신고 처리 (거절하면 사유를 제보자에게 보여 줌)
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { ErrorState, Loading } from '../components/Status.jsx';

const TABS = [
  ['pending', '검토 중'],
  ['approved', '승인됨'],
  ['rejected', '거절됨'],
];
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const label = (values, opts) => (values || []).map((v) => opts.find((o) => o.value === v)?.label || v).join(', ');

const KINDS = [
  ['games', '게임 제보'],
  ['photos', '표지 사진 제보'],
  ['ended', '서비스 종료 제보'],
  ['fix', '정보 수정 제보'],
  ['reviews', '리뷰 신고'],
];
const REVIEW_TABS = [
  ['pending', '검토 중'],
  ['upheld', '숨김'],
  ['dismissed', '문제 없음'],
];
const HELP = {
  games: '승인하면 검색·나만의 게임 찾기·상세 페이지에 ‘사용자 제보’ 게임으로 추가돼요.',
  photos: '승인하면 사진이 없는 게임의 카드·상세 표지로 보여요. 출처 주소에서 같은 게임의 실제 사진인지 확인해 주세요.',
  ended: '승인하면 그 게임을 추천·검색·목록에서 숨겨요(상세 페이지는 종료 안내와 함께 열림). 근거 주소를 꼭 확인해 주세요.',
  fix: '승인하면 추천 인원·플레이 시간·구매처를 ‘사용자 제보’ 값으로 바꿔 보여 줘요. 설명에만 적힌 내용은 자동으로 반영되지 않아요.',
  reviews: '숨긴 리뷰는 작성자에게만 보이고 평점에서 빠져요. ‘문제 없음’이면 그대로 둬요.',
};
const loaders = {
  games: (tab) => api.adminSubmissions(tab),
  photos: (tab) => api.adminImageSubmissions(tab),
  ended: (tab) => api.adminReports('ended', tab),
  fix: (tab) => api.adminReports('fix', tab),
  reviews: (tab) => api.adminReviewReports(tab),
};

export function AdminPage({ options }) {
  const { user, ready } = useAuth();
  const [kind, setKind] = useState('games');
  const [tab, setTab] = useState('pending');
  const list = useAsync(() => (user?.isAdmin ? loaders[kind](tab) : Promise.resolve(null)), [tab, kind, user?.isAdmin]);

  if (!ready) return <Loading />;
  if (!user?.isAdmin) {
    return (
      <div className="state">
        <h1>관리자만 볼 수 있어요</h1>
        <p className="muted">관리자 계정으로 로그인해 주세요.</p>
        <Link to="/" className="btn btn-primary">
          홈으로
        </Link>
      </div>
    );
  }
  const counts = list.data?.counts ?? {};
  const tabs = kind === 'reviews' ? REVIEW_TABS : TABS;
  const card = (item) => {
    if (kind === 'photos') return <PhotoCard key={item.id} item={item} onChanged={list.retry} />;
    if (kind === 'ended' || kind === 'fix') return <ReportCard key={item.id} item={item} onChanged={list.retry} />;
    if (kind === 'reviews') return <ReviewReportCard key={item.reviewId} item={item} onChanged={list.retry} />;
    return <SubmissionCard key={item.id} item={item} options={options} onChanged={list.retry} />;
  };
  return (
    <div className="admin-page">
      <section className="page-head">
        <h1>제보 관리</h1>
        <p className="muted">
          {HELP[kind]} {kind !== 'reviews' && '거절 사유는 제보한 회원에게 보여요.'}
        </p>
      </section>
      <div className="admin-kinds" role="group" aria-label="제보 종류">
        {KINDS.map(([k, name]) => (
          <button
            key={k} type="button" className={`chip-btn${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setTab('pending');
            }}
            data-testid={`admin-kind-${k}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="제보 상태">
        {tabs.map(([key, name]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)} data-testid={`admin-tab-${key}`}>
            {name} <span className="count">{counts[key] ?? ''}</span>
          </button>
        ))}
      </div>
      {list.status === 'loading' && <Loading />}
      {list.status === 'error' && <ErrorState error={list.error} onRetry={list.retry} />}
      {list.status === 'success' &&
        (list.data.items.length === 0 ? (
          <p className="section-empty">{tab === 'pending' ? '검토할 제보가 없어요.' : '없어요.'}</p>
        ) : (
          <div className="admin-list">{list.data.items.map(card)}</div>
        ))}
    </div>
  );
}

/** 승인·거절 버튼 묶음 (거절·내리기는 사유 입력) */
function Decide({ item, onApprove, onReject, approveLabel, onChanged, testid = 'approve' }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {rejecting ? (
        <div className="reject-box">
          <label htmlFor={`dreason-${item.id}`} className="small">
            {item.status === 'approved' ? '되돌리는 이유' : '거절 사유'} (제보한 회원에게 보여요)
          </label>
          <textarea id={`dreason-${item.id}`} rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>
              취소
            </button>
            <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => act(() => onReject(reason))} data-testid="confirm-reject">
              {item.status === 'approved' ? '되돌리기' : '거절'}
            </button>
          </div>
        </div>
      ) : (
        <div className="form-actions">
          {item.status !== 'approved' && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(onApprove)} data-testid={testid}>
              {approveLabel}
            </button>
          )}
          {item.status !== 'rejected' && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)} data-testid="reject">
              {item.status === 'approved' ? '되돌리기' : '거절'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** 서비스 종료·정보 수정 제보 */
function ReportCard({ item, onChanged }) {
  const fix = item.fix || {};
  return (
    <article className="admin-card panel admin-card-wide" data-testid="admin-report-card">
      <div className="admin-card-body">
        <header>
          <h2>
            <Link to={`/games/${item.gameId}`}>{item.gameTitle}</Link> <span className="pill pill-light">{item.kind === 'ended' ? '서비스 종료' : '정보 수정'}</span>
          </h2>
          <p className="muted small">
            {item.submitter ?? '(탈퇴한 회원)'} · {fmt(item.createdAt)} 제보
            {item.reviewedAt && ` · ${fmt(item.reviewedAt)} 처리`}
          </p>
        </header>
        {item.kind === 'fix' && (
          <ul className="admin-fix">
            {fix.players && <li>추천 인원: {fix.players.min}~{fix.players.max}명</li>}
            {fix.hours && <li>플레이 시간: 약 {fix.hours}시간</li>}
            {fix.storeUrl && (
              <li>
                구매처:{' '}
                <a href={fix.storeUrl} target="_blank" rel="noopener noreferrer">
                  {fix.storeUrl}
                </a>
              </li>
            )}
            {!fix.players && !fix.hours && !fix.storeUrl && <li className="muted">자동 반영할 값 없음 (설명 참고)</li>}
          </ul>
        )}
        {item.sourceUrl && (
          <p className="small">
            근거:{' '}
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              {item.sourceUrl}
            </a>
          </p>
        )}
        {item.note && <p className="admin-summary">{item.note}</p>}
        {item.rejectReason && <p className="form-error">거절 사유: {item.rejectReason}</p>}
        <Decide
          item={item} onChanged={onChanged} testid="approve-report"
          approveLabel={item.kind === 'ended' ? '승인 (목록에서 숨김)' : '승인 (정보 반영)'}
          onApprove={() => api.approveReport(item.id)} onReject={(reason) => api.rejectReport(item.id, reason)}
        />
      </div>
    </article>
  );
}

/** 신고된 리뷰 (신고 여러 건을 한 카드에) */
function ReviewReportCard({ item, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await api.resolveReviewReport(item.reviewId, action);
      onChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <article className="admin-card panel admin-card-wide" data-testid="admin-review-card">
      <div className="admin-card-body">
        <header>
          <h2>
            <Link to={`/games/${item.gameId}`}>{item.gameTitle}</Link> <span className="pill pill-warn">신고 {item.count}건</span>
            {item.hidden && <span className="pill pill-light">숨김</span>}
          </h2>
          <p className="muted small">
            작성자 {item.author} · 별점 {item.rating}점 · {fmt(item.createdAt)}
          </p>
        </header>
        <blockquote className="admin-review-quote">{item.content || <span className="muted">(내용 없이 별점만)</span>}</blockquote>
        <ul className="admin-reports-list">
          {item.reports.map((r, i) => (
            <li key={i}>
              <b>{r.reasonText}</b> — {r.reporter ?? '(탈퇴한 회원)'} · {fmt(r.createdAt)}
              {r.note && <span className="muted"> · {r.note}</span>}
            </li>
          ))}
        </ul>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {item.hidden ? (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('restore')} data-testid="restore-review">
              다시 보이기
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => act('hide')} data-testid="hide-review">
                리뷰 숨기기
              </button>
              {item.reports.some((r) => r.status === 'pending') && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('dismiss')} data-testid="dismiss-review">
                  문제 없음
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function SubmissionCard({ item, options, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const rows = [
    ['영문(원제)', item.originalTitle],
    ['플랫폼', label(item.platforms, options.platforms)],
    ['장르', label(item.genres, options.genres)],
    ['추천 인원', item.playersMin != null ? `${item.playersMin}~${item.playersMax}명` : null],
    ['개발·유통사', item.publisher],
    ['출시 연도', item.releaseYear],
    [
      '구매처',
      item.storeUrl ? (
        <a href={item.storeUrl} target="_blank" rel="noopener noreferrer">
          {item.storeUrl}
        </a>
      ) : null,
    ],
  ];
  return (
    <article className="admin-card panel" data-testid="admin-card">
      <div className="admin-card-cover">
        {item.imageUrl ? <img src={item.imageUrl} alt={`${item.title} 표지`} /> : <div className="cover-empty cover"><span className="cover-empty-note">이미지 없음</span></div>}
      </div>
      <div className="admin-card-body">
        <header>
          <h2>{item.title}</h2>
          <p className="muted small">
            {item.submitter ?? '(탈퇴한 회원)'} · {fmt(item.createdAt)} 제보
            {item.reviewedAt && ` · ${fmt(item.reviewedAt)} 처리`}
          </p>
        </header>
        <dl className="admin-rows">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || <span className="muted">-</span>}</dd>
            </div>
          ))}
        </dl>
        {item.summary && <p className="admin-summary">{item.summary}</p>}
        {item.rejectReason && <p className="form-error">거절 사유: {item.rejectReason}</p>}
        <p className="small">
          <a href={`/search?q=${encodeURIComponent(item.title)}`} target="_blank" rel="noopener noreferrer">
            같은 이름이 이미 있는지 검색 ↗
          </a>
          {item.gameId && (
            <>
              {' · '}
              <Link to={`/games/${item.gameId}`}>추가된 게임 보기</Link>
            </>
          )}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {rejecting ? (
          <div className="reject-box">
            <label htmlFor={`reason-${item.id}`} className="small">
              {item.status === 'approved' ? '내리는 이유' : '거절 사유'} (제보한 회원에게 보여요)
            </label>
            <textarea id={`reason-${item.id}`} rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 이미 등록된 게임이에요" />
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>
                취소
              </button>
              <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => act(() => api.rejectSubmission(item.id, reason))} data-testid="confirm-reject">
                {item.status === 'approved' ? '내리기' : '거절'}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            {item.status !== 'approved' && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => api.approveSubmission(item.id))} data-testid="approve">
                승인 (게임 추가)
              </button>
            )}
            {item.status !== 'rejected' && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)} data-testid="reject">
                {item.status === 'approved' ? '내리기' : '거절'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function PhotoCard({ item, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <article className="admin-card panel" data-testid="admin-photo-card">
      <div className="admin-card-cover">
        <a href={item.imageUrl} target="_blank" rel="noopener noreferrer">
          <img src={item.imageUrl} alt={`${item.gameTitle} 제보 사진`} />
        </a>
      </div>
      <div className="admin-card-body">
        <header>
          <h2>
            <Link to={`/games/${item.gameId}`}>{item.gameTitle}</Link>
          </h2>
          <p className="muted small">
            {item.submitter ?? '(탈퇴한 회원)'} · {fmt(item.createdAt)} 제보
            {item.reviewedAt && ` · ${fmt(item.reviewedAt)} 처리`}
          </p>
        </header>
        <dl className="admin-rows">
          <div>
            <dt>출처</dt>
            <dd>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                {item.sourceUrl}
              </a>
            </dd>
          </div>
        </dl>
        {item.rejectReason && <p className="form-error">거절 사유: {item.rejectReason}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {rejecting ? (
          <div className="reject-box">
            <label htmlFor={`preason-${item.id}`} className="small">
              {item.status === 'approved' ? '내리는 이유' : '거절 사유'} (제보한 회원에게 보여요)
            </label>
            <textarea id={`preason-${item.id}`} rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 다른 게임의 사진이에요" />
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>
                취소
              </button>
              <button type="button" className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => act(() => api.rejectImageSubmission(item.id, reason))} data-testid="confirm-reject">
                {item.status === 'approved' ? '내리기' : '거절'}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-actions">
            {item.status !== 'approved' && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => api.approveImageSubmission(item.id))} data-testid="approve-photo">
                승인 (표지로 사용)
              </button>
            )}
            {item.status !== 'rejected' && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)} data-testid="reject">
                {item.status === 'approved' ? '내리기' : '거절'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
