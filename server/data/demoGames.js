// ⚠️ 데모 데이터
// 화면과 추천 기능을 시연하기 위한 '가상의 게임'입니다. 실존 게임·업체·구매처가 아닙니다.
// - 이미지 URL은 넣지 않습니다(실제 확인된 이미지가 없음).
// - 구매처는 앱 내부의 '데모 구매처' 안내 페이지로만 연결됩니다.
// - 일부 게임은 정보 없음(null) 상태를 시연하기 위해 필드를 비워 두었습니다.

const demoStore = (id) => [{ name: '데모 구매처', url: `/demo-store/${id}`, isDemo: true }];

const raw = [
  { id: 'demo-01', title: '별빛 주방 대소동', publisher: '데모 스튜디오 A', summary: '친구들과 함께 제한 시간 안에 요리를 완성하는 협동 파티 게임입니다.', platforms: ['pc', 'console'], genres: ['party', 'simulation'], players: { min: 1, max: 4 }, rating: '전체이용가' },
  { id: 'demo-02', title: '던전 동맹', publisher: '데모 스튜디오 B', summary: '최대 4명이 각자의 직업을 맡아 던전을 공략하는 협동 롤플레잉 게임입니다.', platforms: ['pc'], genres: ['rpg', 'action'], players: { min: 1, max: 4 }, rating: '15세이용가' },
  { id: 'demo-03', title: '한 줄 퍼즐 산책', publisher: '데모 스튜디오 C', summary: '선을 이어 길을 만드는 혼자 즐기는 퍼즐 게임입니다.', platforms: ['mobile'], genres: ['puzzle'], players: { min: 1, max: 1 }, rating: '전체이용가' },
  { id: 'demo-04', title: '레이스 크루 2인조', publisher: '데모 스튜디오 A', summary: '화면 분할로 둘이 함께 달리는 레이싱 게임입니다.', platforms: ['console'], genres: ['racing'], players: { min: 1, max: 2 }, rating: '전체이용가' },
  { id: 'demo-05', title: '은하 전선', publisher: '데모 스튜디오 D', summary: '팀을 나눠 기지를 점령하는 온라인 슈팅 게임입니다.', platforms: ['pc', 'console'], genres: ['shooting', 'action'], players: { min: 2, max: 10 }, rating: '청소년이용불가' },
  { id: 'demo-06', title: '마을 농장 이야기', publisher: '데모 스튜디오 E', summary: '농작물을 기르고 마을을 꾸미는 시뮬레이션 게임입니다. 친구 1명과 함께 플레이할 수 있습니다.', platforms: ['pc', 'mobile', 'console'], genres: ['simulation'], players: { min: 1, max: 2 }, rating: '전체이용가' },
  { id: 'demo-07', title: '왕국의 수', publisher: '데모 스튜디오 F', summary: '자원을 모으고 영토를 넓히는 턴제 전략 게임입니다.', platforms: ['pc'], genres: ['strategy'], players: { min: 1, max: 6 }, rating: '12세이용가' },
  { id: 'demo-08', title: '주사위 왕 파티', publisher: '데모 스튜디오 A', summary: '보드판 위에서 미니게임을 겨루는 파티 게임입니다.', platforms: ['console', 'mobile'], genres: ['party'], players: { min: 2, max: 8 }, rating: '전체이용가' },
  { id: 'demo-09', title: '잊힌 등대의 비밀', publisher: '데모 스튜디오 G', summary: '섬의 단서를 모아 이야기를 풀어 가는 어드벤처 게임입니다.', platforms: ['pc', 'mobile'], genres: ['adventure', 'puzzle'], players: { min: 1, max: 1 }, rating: '12세이용가' },
  { id: 'demo-10', title: '골목 축구 리그', publisher: '데모 스튜디오 H', summary: '최대 4명이 한 팀이 되어 경기하는 스포츠 게임입니다.', platforms: ['console', 'pc'], genres: ['sports'], players: { min: 1, max: 4 }, rating: '전체이용가' },
  { id: 'demo-11', title: '폭풍 기사단', publisher: '데모 스튜디오 B', summary: '혼자 진행하는 횡스크롤 액션 롤플레잉 게임입니다.', platforms: ['console'], genres: ['action', 'rpg'], players: { min: 1, max: 1 }, rating: '15세이용가' },
  { id: 'demo-12', title: '오락실 블록 낙하', publisher: '데모 스튜디오 I', summary: '떨어지는 블록을 맞추는 아케이드 퍼즐 게임입니다.', platforms: ['arcade'], genres: ['puzzle'], players: { min: 1, max: 2 }, rating: '전체이용가' },
  // ── 일부 정보가 없는 데모 게임 (정보 없음 표시 시연용) ──
  { id: 'demo-13', title: '구름섬 탐험대', publisher: '데모 스튜디오 J', summary: '하늘 섬을 탐험하는 어드벤처 게임입니다. (플레이 인원 정보 없음)', platforms: ['pc', 'console'], genres: ['adventure'], players: null, rating: '전체이용가' },
  { id: 'demo-14', title: '심야 카드 클럽', publisher: null, summary: '카드를 모아 대결하는 게임입니다. (플랫폼 정보 없음)', platforms: null, genres: ['party', 'strategy'], players: { min: 2, max: 4 }, rating: '12세이용가' },
  { id: 'demo-15', title: '이름 없는 프로젝트 X', publisher: '데모 스튜디오 K', summary: null, platforms: ['mobile'], genres: null, players: null, rating: null, noStore: true },
  { id: 'demo-16', title: '모래시계 레이서', publisher: '데모 스튜디오 H', summary: '모바일에서 즐기는 레이싱 게임입니다. (구매처 정보 없음)', platforms: ['mobile'], genres: ['racing'], players: { min: 1, max: 1 }, rating: '전체이용가', noStore: true },
];

export const DEMO_GAMES = raw.map(({ noStore, ...g }) => ({
  ...g,
  isDemo: true,
  source: '데모 데이터',
  ratingDate: null,
  ratingNo: null,
  contentDescriptors: null,
  platformsRaw: null,
  genresRaw: null,
  imageUrl: null,
  stores: noStore ? [] : demoStore(g.id),
}));
