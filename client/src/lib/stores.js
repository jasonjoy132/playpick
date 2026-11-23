// 상세 '구매처' 칸 순서: 많이 쓰는 공식 스토어 먼저(첫 번째가 주황 버튼).
// 회원 제보 구매처는 공식(IGDB·App Store) 뒤, 데모 안내는 맨 뒤. 같은 스토어가 여럿이면(예: itunes·apps.apple 옛/새 주소) 앞의 하나만
export const STORE_ORDER = [
  'Steam',
  'PlayStation Store',
  'Nintendo eShop',
  'Microsoft Store (Xbox)',
  'Microsoft Store',
  'Epic Games Store',
  'GOG',
  'App Store',
  'Google Play',
  'itch.io',
];

export function storeRank(s) {
  const i = STORE_ORDER.indexOf(s.appStore ? 'App Store' : s.name);
  return i < 0 ? STORE_ORDER.length : i;
}

export function sortStores(list = []) {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => !!a.s.isDemo - !!b.s.isDemo || !!a.s.userReported - !!b.s.userReported || storeRank(a.s) - storeRank(b.s) || a.i - b.i)
    .map((x) => x.s)
    .filter((s, i, all) => all.findIndex((o) => storeLabel(o) === storeLabel(s)) === i);
}

// 모바일 스토어는 '다운로드', 나머지는 '보기'(가격·판매 여부는 스토어에서 확인)
export function storeLabel(s) {
  const name = s.appStore ? 'App Store' : s.name;
  return name === 'App Store' || name === 'Google Play' ? `${name}에서 다운로드` : `${name}에서 보기`;
}
