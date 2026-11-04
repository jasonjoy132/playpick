import { Link } from '../lib/router.jsx';
import { useFinder } from '../lib/finder.jsx';

export function Loading({ message = '불러오는 중…' }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite" data-testid="state-loading">
      <span className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = '데이터를 불러오지 못했어요', editCriteria }) {
  const { openFinder } = useFinder();
  return (
    <div className="state state-error" role="alert" data-testid="state-error">
      <div className="state-icon" aria-hidden="true">
        !
      </div>
      <h2>{title}</h2>
      <p>{error?.message || '알 수 없는 오류가 발생했습니다.'}</p>
      {error?.code === 'NOT_IMPLEMENTED' && <p className="muted">관리자: README의 ‘데이터와 실제 API 연동’ 항목을 확인해 주세요.</p>}
      <div className="state-actions">
        {onRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            다시 시도
          </button>
        )}
        {editCriteria ? (
          <button type="button" className="btn btn-ghost" onClick={() => openFinder(editCriteria)}>
            조건 다시 설정
          </button>
        ) : (
          <Link to="/" className="btn btn-ghost">
            홈으로
          </Link>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ criteria, title = '조건에 맞는 게임을 찾지 못했어요', children }) {
  const { openFinder } = useFinder();
  return (
    <div className="state state-empty" data-testid="state-empty">
      <div className="state-icon" aria-hidden="true">
        ?
      </div>
      <h2>{title}</h2>
      {children ?? (
        <>
          <p>선택한 조건과 하나라도 일치하는 게임이 없습니다.</p>
          <ul className="tips">
            <li>플랫폼이나 장르를 하나 더 선택해 보세요.</li>
            <li>인원수 조건을 ‘상관없음’으로 바꿔 보세요.</li>
          </ul>
          <button type="button" className="btn btn-primary" onClick={() => openFinder(criteria)}>
            조건 바꾸기
          </button>
        </>
      )}
    </div>
  );
}

export function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <div className="notice" role="status" data-testid="warnings">
      {warnings.map((w) => (
        <p key={w}>⚠ {w}</p>
      ))}
    </div>
  );
}
