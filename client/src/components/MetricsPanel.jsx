// 관리자 '성과' 탭: 원페이저 지표 4개 + 단계별 남은 비율 + 결과 0개·구매처별·들어온 곳 (server/services/metrics.js)
import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { ErrorState, Loading } from './Status.jsx';

// [키, 이름, 정의] — 모두 높을수록 좋음
const KPIS = [
  ['recClickRate', '추천 게임 클릭률', '추천 목록을 본 방문자 중 추천에서 게임 상세로 들어간 비율'],
  ['storeRate', '구매처 이동 비율', '게임 상세를 본 경우 중 그 게임의 구매처 링크를 누른 비율'],
  ['satisfaction', '추천 만족도', '‘이 추천이 도움이 됐나요?’ 응답 중 ‘도움 됐어요’ 비율'],
  ['returnRate', '재방문율', '기간 안에 온 방문자 중 서로 다른 날 2번 이상 온 비율'],
];
const FROM = { results: '추천 목록', search: '검색', popular: '인기 게임', home: '홈', 'for-you': '나를 위한 추천', genre: '장르별', new: '신작·출시 예정', mypage: '마이페이지·찜', other: '바로 들어옴·기타' };
const shortDay = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const pctText = (v) => (v == null ? '—' : `${v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`);
/** 지난 기간과 비교: 좋아졌으면 초록, 나빠졌으면 빨강(색만이 아니라 +/− 글자로도) */
function Delta({ cur, prev, lowerIsBetter = false }) {
  if (cur == null || prev == null) return <span className="delta">지난 기간과 비교할 값 없음</span>;
  const d = Math.round((cur - prev) * 10) / 10;
  const tone = d === 0 ? 'is-flat' : (d > 0) !== lowerIsBetter ? 'is-good' : 'is-bad';
  return (
    <span className="delta">
      지난 기간 {pctText(prev)} <b className={tone}>{d > 0 ? '+' : d < 0 ? '−' : '±'}{Math.abs(d).toLocaleString('ko-KR')}%p</b>
    </span>
  );
}

export function MetricsPanel() {
  const [days, setDays] = useState(7);
  const res = useAsync(() => api.adminMetrics(days), [days]);
  // 기간을 바꾸는 동안 앞 숫자를 흐리게 남겨 둠(화면이 비었다 다시 차며 튀지 않게)
  const last = useRef(null);
  if (res.status === 'success') last.current = res.data;
  const shown = res.status === 'success' ? res.data : res.status === 'loading' ? last.current : null;
  return (
    <div className="metrics" data-testid="metrics">
      <div className="tabs" role="tablist" aria-label="기간">
        {[7, 30].map((d) => (
          <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'is-on' : ''} onClick={() => setDays(d)} data-testid={`metrics-days-${d}`}>
            최근 {d}일
          </button>
        ))}
      </div>
      {res.status === 'loading' && !shown && <Loading />}
      {res.status === 'error' && <ErrorState error={res.error} onRetry={res.retry} />}
      {shown && (
        <div className={`metrics-body${res.status === 'loading' ? ' is-busy' : ''}`} aria-busy={res.status === 'loading'}>
          <MetricsBody data={shown} />
        </div>
      )}
    </div>
  );
}

function MetricsBody({ data }) {
  const { current: cur, previous: prev, range, prevRange } = data;
  // 앞 단계 대비 가장 많이 줄어드는 단계(먼저 고칠 곳)
  const steps = cur.funnel.map((s, i) => (i > 0 && cur.funnel[i - 1].n > 0 ? s.n / cur.funnel[i - 1].n : null));
  const worst = steps.reduce((w, r, i) => (r != null && (w < 0 || r < steps[w]) ? i : w), -1);
  return (
    <>
      <p className="metrics-range">
        <span>
          <b>
            {shortDay(range.from)} ~ {shortDay(range.to)}
          </b>{' '}
          <span className="muted">
            (지난 기간 {shortDay(prevRange.from)} ~ {shortDay(prevRange.to)}과 비교)
          </span>
        </span>
        <span>
          방문자 <b data-testid="metrics-visitors">{cur.visitors.toLocaleString('ko-KR')}</b>명
        </span>
      </p>
      {cur.visitors === 0 && <p className="section-empty">아직 이 기간 기록이 없어요. 사용자 테스트 기간에 사이트 주소를 나눠 주면 여기에 쌓여요.</p>}

      <section className="metrics-block" aria-labelledby="kpi-title">
        <h2 id="kpi-title">원페이저 지표</h2>
        <dl className="kpi-list">
          {KPIS.map(([key, name, def]) => (
            <div key={key} className="kpi" data-testid={`kpi-${key}`}>
              <dt>{name}</dt>
              <dd className="kpi-value">{pctText(cur[key])}</dd>
              <dd className="kpi-diff">
                <Delta cur={cur[key]} prev={prev[key]} />
              </dd>
              <dd className="kpi-def">
                {def}
                {key === 'satisfaction' && ` (응답 ${cur.feedbackCount}개)`}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="metrics-block" aria-labelledby="funnel-title">
        <h2 id="funnel-title">단계별 남은 방문자</h2>
        <p className="muted small">앞 단계에서 가장 많이 줄어드는 곳이 먼저 고칠 곳이에요.</p>
        <ol className="funnel" data-testid="funnel">
          {cur.funnel.map((s, i) => {
            const top = cur.funnel[0].n || 1;
            const before = i > 0 ? cur.funnel[i - 1].n : null;
            return (
              <li key={s.key} className={i === worst ? 'is-worst' : ''} data-testid={`funnel-${s.key}`}>
                <span className="funnel-label">
                  {s.label}
                  {i === worst && <small className="funnel-flag">가장 많이 빠짐</small>}
                </span>
                <span className="funnel-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(s.n ? 2 : 0, (s.n / top) * 100)}%` }} />
                </span>
                <span className="funnel-n">
                  <b>{s.n.toLocaleString('ko-KR')}</b>명
                  {before != null && <span className="muted"> · 앞 단계의 {pctText(before ? Math.round((s.n / before) * 1000) / 10 : null)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="metrics-cols">
        <section className="metrics-block" aria-labelledby="zero-title">
          <h2 id="zero-title">결과 0개 비율</h2>
          <p className="kpi-value" data-testid="metrics-zero">{pctText(cur.zeroRate)}</p>
          <p className="kpi-diff">
            <Delta cur={cur.zeroRate} prev={prev.zeroRate} lowerIsBetter />
          </p>
          <p className="kpi-def">추천 목록 {cur.resultsCount}번 중 ‘모든 조건 일치’ 게임이 없었던 비율. 높으면 그 조건의 게임 정보를 보강해야 해요.</p>
        </section>
        <RankList title="구매처별 이동" id="stores" items={cur.stores} unit="번" empty="아직 구매처로 나간 기록이 없어요." />
        <RankList title="상세로 들어온 곳" id="from" items={cur.detailFrom.map((x) => ({ ...x, name: FROM[x.name] ?? x.name }))} unit="번" empty="아직 상세를 본 기록이 없어요." />
      </div>
    </>
  );
}

function RankList({ title, id, items, unit, empty }) {
  return (
    <section className="metrics-block" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ol className="rank-list" data-testid={`metrics-${id}`}>
          {items.slice(0, 8).map((x) => (
            <li key={x.name}>
              <span>{x.name}</span>
              <b>
                {x.n.toLocaleString('ko-KR')}
                {unit}
              </b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
