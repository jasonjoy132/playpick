// 제보 보상: 기여자 순위('명예의 전당' 메뉴 /hall-of-fame) · 홈 '이달의 기여자' 줄 · 내 제보 '내 기여가 만든 변화'
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useAuth } from '../lib/auth.jsx';
import { Link } from '../lib/router.jsx';
import { Avatar } from './Avatar.jsx';
import { NameBadge } from './Badge.jsx';
import { ErrorState, Loading } from './Status.jsx';

const MEDAL = ['🥇', '🥈', '🥉'];
const counts = (c) => [c.games && `게임 ${c.games}`, c.photos && `사진 ${c.photos}`, c.infos && `정보 ${c.infos}`].filter(Boolean).join(' · ');
const monthLabel = (m) => (m ? `${Number(m.slice(5, 7))}월` : '이번 달');

/** 점수 기준 (접힌 안내) */
function ScoreGuide() {
  return (
    <details className="contrib-guide">
      <summary>점수는 어떻게 매기나요?</summary>
      <p>
        <b>승인 점수</b>: 게임 제보 3점 · 표지 사진 2점 · 정보 수정·서비스 종료 1점 (관리자가 승인한 것만)
      </p>
      <p>
        <b>반응 점수</b>: 승인된 뒤 다른 회원이 그 게임을 찜하면 1점, 리뷰를 쓰면 2점, 조회 10회마다 1점. 표지 사진은 그 게임 반응의 절반, 정보 수정은 4분의 1만 내 몫이에요. 게임 하나에서 한 달에 최대 20점까지 받아요.
      </p>
      <p className="muted small">내 찜·리뷰·조회는 세지 않아요. 좋은 게임을 찾아 넣을수록 점수가 올라가요.</p>
    </details>
  );
}

function MyRank({ me, period }) {
  const { user } = useAuth();
  if (!user || !me) return null;
  const r = me[period];
  return (
    <div className="contrib-me" data-testid="contrib-me">
      <Avatar user={user} size="sm" />
      {r.rank ? (
        <p>
          내 순위 <b>{r.rank}위</b> · {r.score}점 <span className="muted small">(승인 {r.base} + 반응 {r.reaction})</span>
        </p>
      ) : (
        <p>
          아직 순위에 없어요. <Link to="/submit">게임을 제보</Link>하거나 게임 상세에서 표지 사진·정보를 채워 보세요.
        </p>
      )}
    </div>
  );
}

/** 명예의 전당: 기여자 순위 (이번 달 / 전체) */
export function ContributorRanking() {
  const [period, setPeriod] = useState('month');
  const { status, data, error, retry } = useAsync(() => api.contributors(period), [period]);
  return (
    <div className="contrib" data-testid="contrib-ranking">
      <div className="tabs" role="group" aria-label="기간">
        {[
          ['month', `${monthLabel(data?.month)} 순위`],
          ['all', '전체 순위'],
        ].map(([v, label]) => (
          <button key={v} type="button" className={period === v ? 'is-on' : ''} aria-pressed={period === v} onClick={() => setPeriod(v)} data-testid={`contrib-${v}`}>
            {label}
          </button>
        ))}
      </div>
      {status === 'loading' && <Loading />}
      {status === 'error' && <ErrorState error={error} onRetry={retry} />}
      {status === 'success' && (
        <>
          <MyRank me={data.me} period={period} />
          {data.items.length === 0 ? (
            <div className="contrib-empty" data-testid="contrib-empty">
              <p>{period === 'month' ? '이번 달 첫 기여자가 되어 보세요!' : '아직 기여자가 없어요. 첫 기여자가 되어 보세요!'}</p>
              <Link to="/submit" className="btn btn-gold">
                게임 제보하기
              </Link>
            </div>
          ) : (
            <>
              <ol className="contrib-podium">
                {data.items.slice(0, 3).map((c, i) => (
                  <li key={c.rank} className={`contrib-top contrib-top-${i + 1}`} data-testid="contrib-item">
                    <span className="contrib-medal" aria-label={`${c.rank}위`}>
                      {MEDAL[i]}
                    </span>
                    <Avatar user={c} size="lg" />
                    <p className="contrib-name">
                      <NameBadge badge={c.badge} size="md" />
                      {c.nickname}
                    </p>
                    <p className="contrib-score">
                      <b>{c.score}</b>점
                    </p>
                    <p className="muted small">
                      승인 {c.base} + 반응 {c.reaction}
                      <br />
                      {counts(c)}
                    </p>
                  </li>
                ))}
              </ol>
              {data.items.length > 3 && (
                <ol className="contrib-list" start={4}>
                  {data.items.slice(3).map((c) => (
                    <li key={c.rank} className="contrib-row" data-testid="contrib-item">
                      <span className="contrib-rank">{c.rank}</span>
                      <Avatar user={c} size="sm" />
                      <span className="contrib-row-name">
                        <NameBadge badge={c.badge} />
                        {c.nickname}
                        <span className="muted small"> {counts(c)}</span>
                      </span>
                      <span className="contrib-row-score">{c.score}점</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          <ScoreGuide />
        </>
      )}
    </div>
  );
}

/** 홈: 이달의 기여자 (없으면 숨김) */
export function HomeContributors() {
  const { status, data } = useAsync(() => api.contributors('month'), [], 'home-contributors');
  if (status !== 'success' || !data.items.length) return null;
  return (
    <section className="row" aria-labelledby="row-contrib" data-testid="home-contributors">
      <header className="row-head">
        <h3 id="row-contrib">{monthLabel(data.month)}의 기여자</h3>
      </header>
      <ol className="home-contrib">
        {data.items.slice(0, 5).map((c, i) => (
          <li key={c.rank} className="home-contrib-item">
            <span className="home-contrib-rank" aria-label={`${c.rank}위`}>
              {c.rank}
            </span>
            <Avatar user={c} size="md" />
            <span className="home-contrib-name">
              <NameBadge badge={c.badge} />
              {c.nickname}
            </span>
            <span className="muted small">{c.score}점</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 내 제보: 내 기여가 만든 변화 */
export function ImpactCard({ impact }) {
  if (!impact) return null;
  const m = impact.rank?.month;
  return (
    <div className="impact" data-testid="impact">
      <p className="impact-title">내 기여가 만든 변화</p>
      {impact.games === 0 ? (
        <p className="muted small">제보가 승인되면 그 게임을 다른 회원이 얼마나 보고 찜했는지 여기에 보여 드려요.</p>
      ) : (
        <ul className="impact-stats">
          <li>
            <b>{impact.games}</b>
            <span>채운 게임</span>
          </li>
          <li>
            <b>{impact.views}</b>
            <span>조회</span>
          </li>
          <li>
            <b>{impact.wishes}</b>
            <span>찜</span>
          </li>
          <li>
            <b>{impact.reviews}</b>
            <span>리뷰</span>
          </li>
        </ul>
      )}
      <p className="impact-rank small">
        {m?.rank ? (
          <>
            이번 달 기여자 <b>{m.rank}위</b> · {m.score}점 ·{' '}
          </>
        ) : null}
        <Link to="/hall-of-fame">명예의 전당 보기 →</Link>
      </p>
      <p className="muted small">다른 회원의 반응만 세요(내 찜·리뷰·조회 제외). 조회는 같은 사람이 하루에 여러 번 열어도 한 번이에요.</p>
    </div>
  );
}

/** 승인된 제보 카드 아래 작은 숫자 */
export function ImpactLine({ item }) {
  if (!item) return null;
  return (
    <p className="impact-line small" data-testid="impact-line" aria-label={`조회 ${item.views}회, 찜 ${item.wishes}개, 리뷰 ${item.reviews}개`}>
      <span aria-hidden="true">👁 {item.views}</span>
      <span aria-hidden="true">♥ {item.wishes}</span>
      <span aria-hidden="true">💬 {item.reviews}</span>
    </p>
  );
}
