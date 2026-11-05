import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { Link, useLocation } from '../lib/router.jsx';
import { criteriaFromSearch, criteriaToSearch, hasAnyCriteria } from '../lib/criteria.js';
import { formatList, formatPlayers, orNoInfo, statusKo, NO_INFO, PARTY_SOURCE } from '../lib/format.js';
import { Cover } from '../components/Cover.jsx';
import { MatchBadges, MatchSummary } from '../components/MatchBadges.jsx';
import { ErrorState, Loading } from '../components/Status.jsx';
import { WishButton } from '../components/WishButton.jsx';
import { GlobalBadge, RatingBadge } from '../components/Stars.jsx';
import { Reviews } from '../components/Reviews.jsx';
import { NameBadge } from '../components/Badge.jsx';
import { useAuth } from '../lib/auth.jsx';
import { toCoverDataUrl } from '../lib/image.js';

export function GamePage({ id, options }) {
  const { search } = useLocation();
  const criteria = criteriaFromSearch(search);
  const qs = hasAnyCriteria(criteria) ? criteriaToSearch(criteria) : '';
  const { status, data, error, retry } = useAsync(() => api.game(id, qs), [id, qs]);
  const back = qs ? `/results?${qs}` : null;

  return (
    <>
      <nav className="breadcrumb">
        {back ? (
          <Link to={back}>← 추천 목록으로</Link>
        ) : (
          <a
            href="/"
            onClick={(e) => {
              if (window.history.length > 1) {
                e.preventDefault();
                window.history.back();
              }
            }}
          >
            ← 뒤로
          </a>
        )}
      </nav>
      {status === 'loading' && <Loading message="게임 정보를 불러오는 중이에요…" />}
      {status === 'error' &&
        (error.code === 'ENDED' ? (
          <div className="state" data-testid="game-ended">
            <h1>서비스가 종료된 게임이에요</h1>
            <p className="muted">더 이상 플레이할 수 없는 게임이라 보여 드리지 않아요.</p>
            <Link to="/" className="btn btn-primary">
              홈으로
            </Link>
          </div>
        ) : (
          <ErrorState title={error.status === 404 ? '게임을 찾을 수 없어요' : undefined} error={error} onRetry={error.status === 404 ? null : retry} />
        ))}
      {status === 'success' && <GameDetail data={data} options={options} />}
    </>
  );
}

function Summary({ game }) {
  const [showOriginal, setShowOriginal] = useState(false);
  if (!game.summary) return <p className="detail-summary muted">게임 소개 {NO_INFO}</p>;
  const ko = game.summaryKo;
  if (!ko || !game.summaryTranslated) {
    return (
      <>
        <p className="detail-summary" lang={ko ? 'ko' : 'en'}>{ko || game.summary}</p>
        {!ko && <p className="muted small" data-testid="translation-note">번역 정보가 없어 원문을 표시합니다.</p>}
      </>
    );
  }
  return (
    <>
      <p className="detail-summary" lang={showOriginal ? 'en' : 'ko'} data-testid="summary">
        {showOriginal ? game.summary : ko}
      </p>
      <p className="muted small">
        {showOriginal ? 'IGDB 원문' : 'IGDB 소개를 DeepL로 번역했어요.'}{' '}
        <button type="button" className="link-btn" onClick={() => setShowOriginal((v) => !v)}>
          {showOriginal ? '번역 보기' : '원문 보기'}
        </button>
      </p>
    </>
  );
}

/** 평균 플레이 시간 값 표시 (출처 구분) */
function PlaytimeValue({ playtime }) {
  if (playtime.source === 'igdb') {
    // IGDB 이용자들이 기록한 시간 (IGDB의 hastily·normally·completely 를 뜻으로 풀어 씀)
    //  - 큰 값: 메인 스토리 + 서브 퀘스트 조금(normally), 없으면 메인 스토리만(hastily)
    //  - 아래 줄: 메인 스토리만 · 모든 요소 100% 완료(completely)
    const extra = [
      playtime.normally && playtime.hastily ? `메인 스토리만 약 ${playtime.hastily}시간` : null,
      playtime.completely ? `모든 요소 100% 완료 약 ${playtime.completely}시간` : null,
    ].filter(Boolean);
    return (
      <span data-testid="playtime-igdb">
        약 {playtime.hours}시간 <span className="muted small">({playtime.normally ? '메인 스토리 + 서브 퀘스트 조금' : '메인 스토리만'})</span>
        {extra.length > 0 && <span className="muted small playtime-extra">{extra.join(' · ')}</span>}
        <span className="muted small">
          (출처:{' '}
          {playtime.url ? (
            <a href={playtime.url} target="_blank" rel="noopener noreferrer">
              IGDB
            </a>
          ) : (
            'IGDB'
          )}{' '}
          이용자 {playtime.count}명 기록)
        </span>
      </span>
    );
  }
  if (playtime.source === 'user') {
    return (
      <>
        약 {playtime.hours}시간 <span className="muted small">(출처: 사용자 제보 · 관리자 확인)</span>
      </>
    );
  }
  if (playtime.source === 'ai') {
    return (
      <>
        약 {playtime.hours}시간 <span className="muted small">(메인 스토리 기준)</span>{' '}
        <span className="pill pill-ai" title="RAWG에 기록이 없어 AI(Google Gemini)가 추정한 값이에요. 틀릴 수 있어요." data-testid="playtime-ai">
          AI 추정
        </span>
      </>
    );
  }
  return (
    <>
      약 {playtime.hours}시간{' '}
      <span className="muted small">
        (출처:{' '}
        <a href={playtime.url} target="_blank" rel="noopener noreferrer">
          RAWG
        </a>
        )
      </span>
    </>
  );
}

/**
 * 평균 플레이 시간 칸
 *  - 값이 있으면 그대로
 *  - 없고 AI에게 물어볼 수 있는 게임(playtimeAsk): 로그인했으면 화면을 띄운 뒤 AI에게 물어 채움, 아니면 로그인 안내
 */
function Playtime({ game }) {
  const { user, ready } = useAuth();
  const { pathname, search } = useLocation();
  const [state, setState] = useState({ status: 'idle', playtime: null });
  const ask = Boolean(game.playtimeAsk && !game.playtime);
  useEffect(() => {
    if (!ask || !user) return undefined;
    let alive = true;
    setState({ status: 'loading', playtime: null });
    api
      .playtime(game.id)
      .then((r) => alive && setState({ status: 'done', playtime: r.playtime }))
      .catch(() => alive && setState({ status: 'done', playtime: null }));
    return () => {
      alive = false;
    };
  }, [ask, user, game.id]);

  if (game.playtime) return <PlaytimeValue playtime={game.playtime} />;
  if (!ask || !ready) return NO_INFO;
  if (!user) {
    return (
      <span className="muted small" data-testid="playtime-login">
        <Link to={`/login?next=${encodeURIComponent(pathname + search)}`}>로그인</Link> 후 AI 추정 플레이 시간을 확인할 수 있어요.
      </span>
    );
  }
  if (state.status !== 'done') {
    return (
      <span className="muted small" data-testid="playtime-loading" aria-live="polite">
        AI 추정 중…
      </span>
    );
  }
  return state.playtime ? <PlaytimeValue playtime={state.playtime} /> : NO_INFO;
}

function GameDetail({ data, options }) {
  const { game, evaluation } = data;
  const [rating, setRating] = useState(game.userRating);
  const [photoOpen, setPhotoOpen] = useState(false);
  const fromIgdb = game.source === 'IGDB';
  const hasGrac = Boolean(game.ratingNo);
  const rows = [
    ...partyRows(game),
    ['플랫폼', formatList(game.platforms, game.platformsRaw, options.platforms)],
    ['장르', formatList(game.genres, game.genresRaw, options.genres)],
    ['국내 이용 등급', game.rating ? `${game.rating}${game.ratingSource && game.ratingSource !== '게임물관리위원회' ? ` (${game.ratingSource})` : ''}` : '국내 등급분류 정보 없음'],
    ['개발·유통사', orNoInfo(game.publisher)],
    ...(fromIgdb ? [['출시일', orNoInfo(game.releaseDate)]] : []),
    [
      '평균 플레이 시간',
      <Playtime key={game.id} game={game} />,
    ],
    ...(hasGrac || (!fromIgdb && game.source !== '사용자 제보')
      ? [
          ['등급분류일', orNoInfo(game.ratingDate)],
          ['등급분류번호', orNoInfo(game.ratingNo)],
          ['내용 정보', orNoInfo(game.contentDescriptors)],
        ]
      : []),
    ...(game.source === '사용자 제보'
      ? [
          [
            '제보자',
            <span className="submitter" data-testid="submitter">
              <NameBadge badge={game.submitterBadge} size="md" />
              {game.submittedBy ? <b>{game.submittedBy}</b> : '(탈퇴한 회원)'}
            </span>,
          ],
        ]
      : []),
    ['데이터 출처', fromIgdb && hasGrac ? 'IGDB (국내 등급: 게임물관리위원회)' : game.source === '사용자 제보' ? '사용자 제보 · 관리자 확인' : game.source],
  ];
  return (
    <article className="detail" data-testid="game-detail">
      <header className="detail-hero">
        {game.bannerUrl && <img className="detail-hero-bg" src={game.bannerUrl} alt="" referrerPolicy="no-referrer" />}
        <div className="detail-hero-shade" />
        <div className="detail-hero-content">
          <div className="detail-cover-wrap">
            <div className={`detail-cover${game.iconUrl ? ' is-icon' : ''}`}>
              {/* App Store 게임은 상세 표지 칸에 아이콘(정사각형)을 잘리지 않게 통째로 */}
              <Cover game={game.iconUrl ? { ...game, imageUrl: game.iconUrl } : game} className={game.iconUrl ? 'cover-icon' : ''} />
            </div>
            {game.appStoreUrl && (
              <a className="appstore-link" href={game.appStoreUrl} target="_blank" rel="noopener noreferrer" data-testid="appstore-link">
                App Store에서 다운로드 ↗
              </a>
            )}
            {game.imageSource === '사용자 제보' ? (
              <span className="image-credit" data-testid="image-credit">
                이미지: 사용자 제보{game.imageBy && <> · <NameBadge badge={game.imageByBadge} />{game.imageBy}</>}
                {game.imageSourceUrl && (
                  <>
                    {' '}
                    <a href={game.imageSourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                      출처 ↗
                    </a>
                  </>
                )}
              </span>
            ) : (
              game.imageSource && <span className="image-credit">이미지: {game.imageSource}</span>
            )}
            {game.canSubmitImage && !photoOpen && (
              <button type="button" className="btn btn-ghost btn-sm photo-btn" onClick={() => setPhotoOpen(true)} data-testid="open-image-submit">
                📷 표지 사진 제보
              </button>
            )}
          </div>
          <div>
            <div className="detail-tags">
              {game.isDemo && <span className="pill pill-demo">데모 데이터</span>}
              {game.hidden && <span className="pill pill-warn">{statusKo(game.gameStatus)}</span>}
              {game.rating && <span className="pill pill-light">{game.rating}</span>}
              {!fromIgdb && !game.isDemo && <span className="pill pill-light">게임물관리위원회</span>}
              {game.domesticRating === false && game.ratingLookup !== undefined && !game.rating && <span className="pill pill-warn">국내 등급 정보 없음</span>}
              <MatchSummary evaluation={evaluation} />
            </div>
            <h1>{game.title}</h1>
            {game.originalTitle && <p className="detail-original">{game.originalTitle}</p>}
            <p className="detail-publisher">{game.publisher || `업체 ${NO_INFO}`}</p>
            <div className="detail-actions">
              <GlobalBadge rating={game.globalRating} />
              <RatingBadge rating={rating} />
              <WishButton game={game} variant="label" />
            </div>
          </div>
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-main">
          {photoOpen && <ImageSubmitBox game={game} onClose={() => setPhotoOpen(false)} />}
          {game.hidden && (
            <p className="notice" data-testid="ended-notice">
              IGDB 기준 ‘{statusKo(game.gameStatus)}’ 상태인 게임이라 추천·검색 목록에는 나오지 않습니다.
            </p>
          )}
          {game.aiUpcoming && (
            <p className="notice" data-testid="ai-upcoming-notice">
              국내 등급분류는 받았지만 <b>아직 출시되지 않은 게임</b>으로 AI(Google Gemini)가 판단했어요. ‘신작·출시 예정 → 출시 예정’에서 볼 수 있어요. AI 판단이라 틀릴 수 있어요.
            </p>
          )}
          {game.userEnded && (
            <p className="notice" data-testid="user-ended-notice">
              회원 제보로 <b>서비스가 종료된 게임</b>으로 확인돼 추천·검색 목록에는 나오지 않습니다.
              {game.endedSourceUrl && (
                <>
                  {' '}
                  <a href={game.endedSourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                    근거 보기 ↗
                  </a>
                </>
              )}
            </p>
          )}
          {game.aiEnded && !game.userEnded && (
            <p className="notice" data-testid="ai-ended-notice">
              AI(Google Gemini)가 <b>서비스가 종료된 게임</b>으로 판단해 추천·검색 목록에는 나오지 않습니다. AI 판단이라 틀릴 수 있어요.
            </p>
          )}
          {game.screenshots?.length > 0 && (
            <section className="panel" aria-labelledby="shots-title" data-testid="screenshots">
              <h2 id="shots-title">
                스크린샷 <span className="muted small">출처: {game.screenshotSource || 'App Store'}</span>
              </h2>
              <div className="shots">
                {game.screenshots.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="shot">
                    {/* 목록에선 가벼운 중간 크기, 누르면 큰 그림 */}
                    <img src={url.replace('/t_screenshot_big/', '/t_screenshot_med/')} alt={`${game.title} 스크린샷 ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                  </a>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <h2>게임 소개</h2>
            <Summary game={game} />
            {game.ratingLookup === 'not_found' && !game.rating && (
              <p className="muted small">게임물관리위원회 등급분류 데이터에서 같은 제목의 게임을 찾지 못했습니다. 제목 표기가 달라 못 찾았을 수도 있으니 국내 이용 가능 여부는 구매처에서 확인해 주세요.</p>
            )}
            {game.source === '사용자 제보' && (
              <p className="muted small">회원이 제보하고 관리자가 확인한 게임이에요. 정보는 제보 내용을 바탕으로 해요.</p>
            )}
            {!fromIgdb && !game.isDemo && game.source !== '사용자 제보' && (
              <p className="muted small">
                IGDB에 없는 게임이라 게임물관리위원회 정보로 표시합니다.{' '}
                {game.appStoreUrl ? '아이콘과 App Store 링크는 App Store에서 이름·개발사가 같은 앱을 찾아 보완했어요. 인원 정보는 없습니다.' : game.imageSource === '사용자 제보' ? '표지 사진은 회원이 제보하고 관리자가 확인했어요. 인원·구매처 정보는 없습니다.' : '인원·이미지·구매처 정보가 없습니다.'}
              </p>
            )}
          </section>

          {evaluation && (
            <section className="panel">
              <h2>내 조건과 비교</h2>
              <MatchBadges evaluation={evaluation} />
            </section>
          )}

          <section className="panel">
            <h2>상세 정보</h2>
            <dl className="info-table">
              {rows.map(([k, v]) => (
                <div key={k} className={v === NO_INFO ? 'is-empty' : ''}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <Reviews gameId={game.id} globalRating={game.globalRating} isIgdb={game.source === 'IGDB'} onStats={(st) => setRating({ count: st.count, avg: st.avg })} />
        </div>

        <aside className="detail-side">
          <section className="panel store-card" aria-labelledby="store-title">
            <h2 id="store-title">구매처</h2>
            {game.stores.length === 0 ? (
              <p className="muted" data-testid="no-store">
                구매처 정보 없음
              </p>
            ) : (
              <ul className="store-list">
                {game.stores.map((s) => (
                  <li key={s.url}>
                    <a className="btn btn-primary btn-block" href={s.url} target="_blank" rel="noopener noreferrer" data-testid="store-link">
                      {s.appStore ? 'App Store에서 다운로드 ↗' : `${s.name}에서 보기 ↗`}
                    </a>
                    {s.isDemo && <p className="store-note">데모 구매처 안내 페이지로 이동합니다. 실제 판매처가 아닙니다.</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="store-foot muted">외부 구매처는 새 창으로 열립니다. 가격·판매 여부는 구매처에서 확인해 주세요.</p>
            {game.igdbUrl && (
              <p className="store-foot">
                <a href={game.igdbUrl} target="_blank" rel="noopener noreferrer">
                  IGDB에서 게임 정보 보기 ↗
                </a>
              </p>
            )}
          </section>
          {!game.isDemo && <ReportBox game={game} />}
        </aside>
      </div>
    </article>
  );
}

/** 추천 인원(출처 표시) + 최대 인원(추천과 다를 때만) */
function partyRows(game) {
  const rec = game.recommendedPlayers;
  if (!rec) return [['플레이 인원', formatPlayers(game.players)]];
  const recCell = (
    <>
      {formatPlayers(rec)}{' '}
      {rec.source === 'ai' ? (
        <span className="pill pill-ai" title="실제 데이터가 아니라 AI(Google Gemini)가 추정한 값이에요. 틀릴 수 있어요." data-testid="party-ai">
          AI 추정
        </span>
      ) : (
        <span className="muted small">(출처: {PARTY_SOURCE[rec.source] || rec.source})</span>
      )}
    </>
  );
  const rows = [['추천 인원', recCell]];
  const p = game.players;
  if (p && (p.min !== rec.min || p.max !== rec.max)) rows.push(['최대 인원', <>{formatPlayers(p)} <span className="muted small">(출처: IGDB)</span></>]);
  return rows;
}

/** 사진이 없는 게임에 표지 사진 제보 (관리자 승인 후 표시, 관리자는 바로 등록) */
function ImageSubmitBox({ game, onClose }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const [image, setImage] = useState(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [state, setState] = useState({});
  if (!user) {
    return (
      <section className="panel photo-box" data-testid="image-submit">
        <h2>표지 사진 제보</h2>
        <p className="muted">
          <Link to={`/login?next=${encodeURIComponent(pathname + search)}`}>로그인</Link>하면 이 게임의 표지 사진을 제보할 수 있어요.
        </p>
      </section>
    );
  }
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setState({});
      setImage(await toCoverDataUrl(file));
    } catch (err) {
      setState({ error: err.message });
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const { item } = await api.submitImage(game.id, { image, sourceUrl });
      setState({ done: item.status === 'approved' ? '바로 등록했어요. 새로고침하면 표지로 보여요.' : '제보했어요! 관리자가 확인한 뒤 승인하면 표지로 보여요. 마이페이지 ‘내 제보’에서 상태를 볼 수 있어요.' });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  if (state.done) {
    return (
      <section className="panel photo-box" data-testid="image-submit-done">
        <h2>표지 사진 제보</h2>
        <p>{state.done}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          닫기
        </button>
      </section>
    );
  }
  return (
    <form className="panel photo-box" onSubmit={submit} data-testid="image-submit">
      <h2>표지 사진 제보</h2>
      <p className="muted small">
        공식 스토어·공식 사이트에서 확인할 수 있는 <b>이 게임의 실제 사진</b>만 올려 주세요. 관리자가 출처를 확인한 뒤 표지로 보여 줘요. 승인되면 사진 칭호 실적에 들어가요.
      </p>
      <div className="photo-box-row">
        <label className="photo-pick">
          {image ? <img src={image} alt="고른 사진 미리보기" className="cover-preview" /> : <span>사진 고르기</span>}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} data-testid="image-input" />
        </label>
        <div className="photo-box-fields">
          <label htmlFor="photo-src">출처 주소</label>
          <input id="photo-src" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… (공식 스토어·공식 사이트 페이지)" maxLength={300} required />
          {state.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={state.busy}>
              취소
            </button>
            <button type="submit" className="btn btn-gold" disabled={state.busy || !image || !sourceUrl.trim()} data-testid="submit-image">
              {user.isAdmin ? '바로 등록' : '제보하기'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

/** 정보가 틀렸나요? — 서비스 종료 제보·정보 수정 제보 (관리자 확인 후 반영, 관리자는 바로 반영) */
function ReportBox({ game }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const [kind, setKind] = useState(null);
  const [f, setF] = useState({ sourceUrl: '', note: '', playersMin: '', playersMax: '', hours: '', storeUrl: '' });
  const [state, setState] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const open = (k) => {
    setKind(k);
    setState({});
  };
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const body = kind === 'ended' ? { kind, sourceUrl: f.sourceUrl, note: f.note } : { kind, ...f };
      const { item } = await api.reportGame(game.id, body);
      setKind(null);
      setState({ done: item.status === 'approved' ? '바로 반영했어요. 새로고침하면 보여요.' : '제보했어요! 관리자가 확인한 뒤 반영돼요. 마이페이지 ‘내 제보’에서 결과를 볼 수 있어요.' });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <section className="panel report-box" aria-labelledby="report-title" data-testid="report-box">
      <h2 id="report-title">정보가 틀렸나요?</h2>
      <p className="muted small">서비스가 끝났거나 정보가 다르면 알려 주세요. 관리자가 확인한 뒤 반영해요.</p>
      {state.done && (
        <p className="small" role="status" data-testid="report-done">
          {state.done}
        </p>
      )}
      {!user ? (
        <p className="small">
          <Link to={`/login?next=${encodeURIComponent(pathname + search)}`}>로그인</Link>하면 제보할 수 있어요.
        </p>
      ) : !kind ? (
        <div className="report-actions">
          {!game.userEnded && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('ended')} data-testid="open-report-ended">
              서비스 종료 제보
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('fix')} data-testid="open-report-fix">
            정보 수정 제보
          </button>
        </div>
      ) : (
        <form onSubmit={submit} data-testid={`report-form-${kind}`}>
          <p className="small">
            <b>{kind === 'ended' ? '서비스 종료 제보' : '정보 수정 제보'}</b>
          </p>
          {kind === 'fix' && (
            <>
              <div className="row2">
                <label className="field">
                  추천 인원 최소
                  <input type="number" min={1} max={100} value={f.playersMin} onChange={set('playersMin')} />
                </label>
                <label className="field">
                  추천 인원 최대
                  <input type="number" min={1} max={100} value={f.playersMax} onChange={set('playersMax')} />
                </label>
              </div>
              <label className="field">
                메인 스토리 플레이 시간(시간)
                <input type="number" min={1} max={1000} value={f.hours} onChange={set('hours')} />
              </label>
              <label className="field">
                구매처(공식 스토어 주소)
                <input type="url" value={f.storeUrl} onChange={set('storeUrl')} placeholder="https://store.steampowered.com/app/…" />
              </label>
            </>
          )}
          <label className="field">
            {kind === 'ended' ? '근거 주소 (종료 공지·기사 등, 필수)' : '근거 주소 (선택)'}
            <input type="url" value={f.sourceUrl} onChange={set('sourceUrl')} placeholder="https://…" required={kind === 'ended'} />
          </label>
          <label className="field">
            {kind === 'ended' ? '설명 (선택)' : '설명 (다른 정보가 틀렸다면 여기에)'}
            <textarea rows={2} maxLength={500} value={f.note} onChange={set('note')} placeholder={kind === 'ended' ? '예: 2023년 6월 서비스 종료' : '예: 플랫폼에 PS5도 있어요'} />
          </label>
          {state.error && (
            <p className="form-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKind(null)} disabled={state.busy}>
              취소
            </button>
            <button type="submit" className="btn btn-gold btn-sm" disabled={state.busy} data-testid="submit-report">
              {user.isAdmin ? '바로 반영' : '제보하기'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
