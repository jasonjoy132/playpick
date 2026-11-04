export const NO_INFO = '정보 없음';

export function formatPlayers(p) {
  if (!p || p.min == null || p.max == null) return NO_INFO;
  if (p.min === p.max) return p.min === 1 ? '1명 (싱글 플레이)' : `${p.min}명`;
  return `${p.min}~${p.max}명`;
}

/** 목록 카드용 짧은 인원 표시: 추천 인원이 있으면 그것(AI 추정이면 'AI' 표시), 없으면 최대 인원 */
export function shortPlayers(game) {
  const rec = game.recommendedPlayers;
  if (rec) return `${formatPlayers(rec)}${rec.source === 'ai' ? ' (AI)' : ''}`;
  return game.players ? formatPlayers(game.players) : null;
}

export const PARTY_SOURCE = {
  'igdb-coop': 'IGDB 협동 플레이 인원',
  igdb: 'IGDB',
  ai: 'AI 추정',
  user: '사용자 제보',
};

/** 표준 값 → 라벨. 분류되지 않은 원본 문자열만 있으면 원본을 그대로 보여줌 */
export function formatList(values, raw, options) {
  if (values && values.length) {
    const map = Object.fromEntries((options || []).map((o) => [o.value, o.label]));
    return values.map((v) => map[v] || v).join(', ');
  }
  if (raw) return `${raw} (분류 확인 필요)`;
  return NO_INFO;
}

export const orNoInfo = (v) => (v == null || v === '' ? NO_INFO : v);

export function criteriaLabels(criteria, options) {
  const out = [];
  if (!options) return out;
  if (criteria.players != null) {
    const o = options.players.find((x) => x.value === criteria.players);
    out.push({ key: 'players', label: '인원', value: o ? o.label : `${criteria.players}명` });
  }
  const lab = (vals, opts) => vals.map((v) => opts.find((o) => o.value === v)?.label || v).join(', ');
  if (criteria.platforms.length) out.push({ key: 'platforms', label: '플랫폼', value: lab(criteria.platforms, options.platforms) });
  if (criteria.genres.length) out.push({ key: 'genres', label: '장르', value: lab(criteria.genres, options.genres) });
  return out;
}

const STATUS_KO = { released: '출시', offline: '서비스 종료', delisted: '판매 중단', cancelled: '개발 취소', 'early access': '앞서 해보기', alpha: '알파', beta: '베타', rumored: '출시 미정(소문)' };
export const statusKo = (s) => (s ? STATUS_KO[String(s).toLowerCase()] || s : null);
