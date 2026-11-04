# PlayPick (플레이픽) — 작업 안내

인원·플랫폼·장르로 **친구들과 같이 할 게임**을 찾아 주는 게임 큐레이션 사이트(학교 과제, Vercel 배포 예정).
흐름: 조건 고르기 → 매칭(나만의 게임 찾기) → 추천 목록 → 상세 → 구매처.

- 사용자와는 **항상 한국어**로 대화. 설명은 짧게.
- 사용자 PC: Windows, 프로젝트 폴더 `D:\Ajou Univ\2-2\실웹개\사이트\playpick_1\playpick`

## 꼭 지킬 규칙

1. **API 키는 서버 `.env`에만.** 브라우저(client)로 보내거나 로그에 남기지 않기. **`.env`는 읽거나 고치지 말 것**(필요한 키 이름만 `.env.example`에 적기). 사용자에게 키를 채팅에 붙여 넣으라고 하지 않기.
2. **확인되지 않은 데이터는 만들지 않기.** 없으면 '정보 없음'. 실제로 확인되지 않은 게임 이미지·구매처 URL을 만들지 말 것(원래 요구사항).
3. AI 추정값은 항상 출처를 구분해 표시(`source: 'ai'` → 화면에 'AI 추정'). 회원 제보는 '사용자 제보 · 관리자 확인'.
4. `node_modules`, `.data`(회원 DB·업로드 이미지), `.cache`는 건드리지 않기(캐시 삭제가 필요하면 먼저 물어보기).
5. 기능을 바꾸면 테스트도 함께 고치고 `npm test`, `npm run test:e2e` 통과 확인.
6. `prefill:*` / `import:status` 스크립트는 같은 파일(`server/data/party-size.json`)에 쓰므로 **동시에 두 개 돌리지 않기**.

## 스택

- 서버: `node:http`(프레임워크 없음) — `server/index.js` → `server/app.js`(모든 API 라우트)
- DB: `node:sqlite`(SQLite, 동기 API) — `.data/playpick.db`, 스키마·열 추가는 `server/db.js`(시작할 때 자동 생성·보충)
- 화면: React 19 + esbuild(`scripts/build.mjs`, `client/public` 파일은 `client/dist`로 평평하게 복사), 자체 라우터 `client/src/lib/router.jsx`
- 테스트: `node:test` 단위(`test/`), Playwright E2E(`e2e/`, 가짜 카탈로그 주입 방식)
- 요구: Node 20+ (node:sqlite 사용)

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` / `npm start` | 개발 서버 / 빌드 후 실행 (기본 포트 4000) |
| `npm run build` | 화면 빌드 |
| `npm test` / `npm run test:e2e` | 단위 / E2E 테스트 |
| `npm run check:apis` · `check:search` · `check:gemini` | 외부 API·검색·Gemini 모델 점검 |
| `npm run check:game -- <이름>` | 게임 하나가 왜 보이는지/숨겨지는지 진단(IGDB·게관위·AI 판단) |
| `npm run prefill:players -- [--igdb N] [--grac N] [--recheck] [--recheck-unknown] [--model M]` | AI 추천 인원·플레이 시간·게관위 서비스 상태 미리 저장 |
| `npm run prefill:ended -- [--igdb N] [--online N] [--only grac\|popular\|online] [--export] [--rescan]` | IGDB 게임 서비스 종료 여부 AI 확인(후보는 `.cache/ended-candidates.json`에 24시간 저장) |
| `npm run prefill:images` | 게관위 모바일 게임 App Store 아이콘·스크린샷 저장 |
| `npm run import:status -- <결과.csv>` | 외부 AI 결과(게관위 '모름'·IGDB 종료) 반영. `--dry`, `--force` |

## 데이터 출처와 구조

- **IGDB**(주 데이터, 전체 게임 실시간 조회): `server/providers/igdbProvider.js` (Apicalypse, 초당 4회 제한 `slot()`)
- **게임물관리위원회(게관위)**: 전체 목록 색인 `.cache/grac-index.json`(약 3.3만 건, 매일 증분·주 1회 전체), IGDB에 있는지 확인 캐시 `.cache/grac-igdb-check.json`. IGDB에 없는 게관위 게임만 '게관위 카드'로 보임
- **RAWG**: 평균 플레이 시간 / **DeepL**: 소개 번역·검색어 번역 / **App Store 검색 API**: 게관위 모바일 게임 아이콘(이름+개발사 모두 일치할 때만)
- **Gemini**(기본 `gemini-flash-lite-latest`): 서버는 실시간으로 부르지 않고 **미리 저장한 파일만 읽음**
  - `server/data/party-size.json`: 추천 인원·플레이 시간·서비스 상태(게관위 `status`, IGDB `ended`)·근거
  - `server/data/app-store.json`: App Store 아이콘·스크린샷
  - `server/data/status-review/`: 외부 AI용 내보내기 CSV와 질문(PROMPT*.md), 결과 CSV
- 서버가 켜져 있으면 데이터 파일 변경을 30초 안에 다시 읽음

### 목록에서 숨기는 규칙 (`server/app.js`의 `listable`)
- AI가 서비스 종료로 판단(`aiEnded`) 또는 회원 서비스 종료 제보 승인(`userEnded`) → 숨김
- 게관위 게임: '출시 예정'은 출시 예정 목록에만. 기본으로 **AI가 '서비스 중'이라 했거나 App Store에 있을 때만** 보임(`HIDE_UNKNOWN_GRAC=off`면 '모름'도 보임). AI 데이터 파일이 없으면 숨기지 않음
- IGDB 자체 상태(Offline 등)도 숨김. 상세 페이지는 항상 열림(안내 문구 표시)

### 게임 정보에 덧붙이는 순서 (`decorate`)
`partySize.applyCached` → `appArt.applyAll`(App Store) → `imageSubs.applyAll`(승인된 표지 사진) → `reports.applyAll`(승인된 종료·정보 수정 제보) → 별점·찜

## 회원 기능 (`server/community/`)

- 계정·세션·비밀번호 재설정(메일: Brevo), 찜, 별점·리뷰(1인 1리뷰, 수정 불가·삭제 후 재작성), 최근 본 게임
- **제보**(모두 로그인 필요, 관리자 승인 후 반영, 관리자가 직접 올리면 바로 승인)
  - 게임 제보 `submissions.js` → 승인 시 `user-<번호>` 게임
  - 표지 사진 제보 `imageSubmissions.js`(출처 주소 필수)
  - 서비스 종료 제보·정보 수정 제보(추천 인원·플레이 시간·구매처) `reports.js`
  - 리뷰 신고 `reports.js` → 관리자가 숨기면 작성자에게만 보이고 평점·칭호 계산에서 빠짐
- **관리자**: `.env`의 `ADMIN_EMAILS`(쉼표 구분) 이메일로 가입한 계정. 화면 `/admin`(제보 종류별 탭)
- **칭호·뱃지** `badges.js`: 저장 없이 그때그때 계산(대표 칭호 `users.title_badge`, 알림 확인 `users.badges_seen`)
  - 단계: 제보(finder~curator), 리뷰(rv1~rv5), 사진(ph1~ph3), 정보(if1~if3) + 특별 뱃지(pioneer, popular, thorough, local, early, essay, cleaner, firstword)
  - 그림 `client/public/badge-<id>.webp`(128px, 배경 투명). 그림이 없으면 `noImage: true`로 이모지 표시
  - 새 칭호 알림(토스트), 대표 칭호 고르기(`BadgePicker.jsx`: 마이페이지·홈 프로필 패널)

## 남은 일 (우선순위)

1. **Vercel + Supabase 배포 전환** (학교 과제, Vercel Hobby 요금제)
   - DB를 Supabase(PostgreSQL)로: 지금 `node:sqlite` 동기 호출을 전부 `await`로, SQL 문법(`?`→`$1`, `INSERT OR IGNORE`→`ON CONFLICT`, 자동 증가 등) 변환. Vercel에서는 Supabase **연결 풀러 주소(6543)** 사용. 로컬도 Supabase로 통일할지 사용자와 결정
   - 업로드 이미지(`.data/` 아래 프로필·제보 사진) → Supabase Storage
   - 게관위 색인 `.cache/grac-index.json`(git 제외 중)을 배포에 포함하는 방법 정하기(서버 시작마다 3만 건 다시 받으면 너무 느림)
   - 메모리 기반 요청 제한(rateLimit)은 인스턴스마다 따로라는 점 고려
   - `vercel.json`, 환경 변수 목록 정리
2. 개인정보처리방침·이용약관 페이지, 데이터 출처 표기(IGDB·게관위·App Store·AI 추정)
3. 안 쓰는 파일 정리: `client/src/components/GameCard.jsx`, `Steps.jsx`, `client/src/pages/WishlistPage.jsx`(사용자 PC에만 남아 있을 수 있음)
4. GitHub commit·push (`.gitignore`가 `.env`, `.data/`, `.cache/`, `node_modules/`, `client/dist/` 제외 중 — push 전 `git status`로 확인)
5. (선택) 제보 승인·거절 알림, 관리자 메뉴에 대기 건수, 모바일 화면 점검, 게임 상세 페이지 제목·미리보기, 친구와 같이 고르는 '파티 투표'
