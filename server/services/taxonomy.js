// 조건 선택지와 게임물관리위원회 API 원본 값 → 표준 값 매핑
// 게임위 Open API 가이드(grac.or.kr/OpenBook/OpenAPIGuide.aspx) 출력 변수 설명에 적힌 값 목록 기준:
//   genre   : 격투게임, 교육용, 레이싱, 롤플레잉, 보드게임, 보드게임(베팅성), 스포츠, 시뮬레이션, 액션,
//             어드벤처, 전략시뮬레이션, 캐주얼, 퍼즐, FPS/TPS, MMORPG, 비행슈팅, 크레인, 기타
//   platform: PC/온라인 게임, 비디오 게임, 모바일 게임, 아케이드 게임
// 아래 표에 없는 값(교육용·캐주얼·크레인·기타·보드게임(베팅성) 등)은 임의로 분류하지 않고
// '분류 확인 필요'(매칭 시 정보 없음)로 처리합니다.

export const PLAYER_OPTIONS = [
  { value: 1, label: '혼자 (1명)' },
  { value: 2, label: '2명' },
  { value: 3, label: '3명' },
  { value: 4, label: '4명' },
  { value: 5, label: '5명 이상' },
];

export const PLATFORMS = [
  { value: 'pc', label: 'PC', grac: ['PC/온라인 게임'] },
  { value: 'mobile', label: '모바일', grac: ['모바일 게임'] },
  { value: 'console', label: '콘솔', grac: ['비디오 게임'] },
  // 아케이드(오락실·인형뽑기 기계)는 '친구와 같이 할 게임'과 맞지 않아 고를 수 없고, 아케이드 전용 게임은 목록·검색에서 뺌(isArcadeOnly).
  // 게임위·IGDB 값 분류에는 계속 씀
  { value: 'arcade', label: '아케이드', grac: ['아케이드 게임'], hidden: true },
];

export const GENRES = [
  { value: 'action', label: '액션', grac: ['액션', '격투게임'] },
  { value: 'rpg', label: '롤플레잉', grac: ['롤플레잉', 'MMORPG'] },
  { value: 'strategy', label: '전략', grac: ['전략시뮬레이션'] },
  { value: 'simulation', label: '시뮬레이션', grac: ['시뮬레이션'] },
  { value: 'adventure', label: '어드벤처', grac: ['어드벤처'] },
  { value: 'shooting', label: '슈팅', grac: ['FPS/TPS', '비행슈팅'] },
  { value: 'sports', label: '스포츠', grac: ['스포츠'] },
  { value: 'racing', label: '레이싱', grac: ['레이싱'] },
  { value: 'puzzle', label: '퍼즐', grac: ['퍼즐'] },
  { value: 'party', label: '보드·파티', grac: ['보드게임'] },
];

const byValue = (list) => Object.fromEntries(list.map((o) => [o.value, o]));
export const PLATFORM_MAP = byValue(PLATFORMS);
export const GENRE_MAP = byValue(GENRES);

const norm = (t) => t.replace(/\s+/g, '').toUpperCase();

/**
 * 게임위 API 원본 문자열 → 표준 값 배열.
 * 가이드에 적힌 값과 '정확히' 일치할 때만 매핑합니다(부분 문자열 매칭 안 함:
 * 예) '전략시뮬레이션'은 전략으로만, '보드게임(베팅성)'은 보드·파티로 분류하지 않음).
 * 쉼표로 여러 값이 오는 경우를 대비해 나눠서 처리합니다.
 * @returns {string[]|null} 매핑된 값. 원본이 비었거나 매핑되는 값이 없으면 null
 */
export function mapGracValue(raw, list) {
  if (raw == null) return null;
  const parts = String(raw).split(',').map(norm).filter(Boolean);
  if (!parts.length) return null;
  const values = list.filter((o) => o.grac.some((g) => parts.includes(norm(g)))).map((o) => o.value);
  return values.length ? values : null;
}

export function getOptions() {
  const strip = (list) => list.filter((o) => !o.hidden).map(({ value, label }) => ({ value, label }));
  return { players: PLAYER_OPTIONS, platforms: strip(PLATFORMS), genres: strip(GENRES) };
}

/** 고를 수 있는 플랫폼 값 (아케이드 제외) */
export const SELECTABLE_PLATFORMS = new Set(PLATFORMS.filter((o) => !o.hidden).map((o) => o.value));

/**
 * 아케이드 기계 전용 게임인지 (오락실·인형뽑기 등) → 목록·검색·나만의 게임 찾기에서 뺌
 * 플랫폼이 아케이드뿐일 때만. PC·모바일 등 다른 플랫폼도 있으면 그대로 보임
 */
export function isArcadeOnly(g) {
  if (g?.platforms?.length) return g.platforms.every((p) => p === 'arcade');
  const raw = String(g?.platformsRaw ?? '');
  return /아케이드/.test(raw) && !/pc|온라인|모바일|비디오/i.test(raw);
}

/** 게임위 장르 '교육용'(타자·퀴즈·학습 앱) — 친구와 같이 노는 게임과 맞지 않음 */
export const isEducational = (g) => String(g?.genresRaw ?? '').split(',').some((x) => x.replace(/\s+/g, '') === '교육용');

/** 체험판(본편이 따로 있는 데모) — 제목에 '체험판'·'데모 버전'·'(Demo)' 등 */
export const isDemoVersion = (g) => /체험판|데모\s*버전|[([]\s*demo\s*[)\]]|\bdemo\s+version\b/i.test(String(g?.title ?? ''));

/**
 * 사이트 목적(친구와 같이 할 게임)과 맞지 않아 목록·검색·나만의 게임 찾기에서 빼는 게임
 *  - 아케이드 기계 전용(오락실·인형뽑기) · 교육용 앱 · 체험판. 상세 페이지는 링크로 열림
 */
export const isOffTopic = (g) => isArcadeOnly(g) || isEducational(g) || isDemoVersion(g);
