# PlayPick (플레이픽) — 작업 안내

인원·플랫폼·장르로 **친구들과 같이 할 게임**을 찾아 주는 게임 큐레이션 사이트(학교 과제, Vercel 배포 예정).
흐름: 조건 고르기 → 매칭(나만의 게임 찾기) → 추천 목록 → 상세 → 구매처.
추천 목록: **모든 조건 일치**를 먼저 보여 주고, 그걸 끝까지 다 본 뒤(서버에 더 없고 다 펼쳤을 때)에만 아래에 일부 조건 일치를 '비슷한 게임'으로 이어 보여 줌. 0개면 바로 '비슷한 게임' (`ResultsPage.jsx`의 `showSimilar`)

- 사용자와는 **항상 한국어**로 대화. 설명은 짧게.
- 사용자 PC: Windows, 프로젝트 폴더 `D:\Ajou Univ\2-2\실웹개\사이트\playpick_1\playpick`

## 꼭 지킬 규칙

1. **API 키는 서버 `.env`에만.** 브라우저(client)로 보내거나 로그에 남기지 않기. **`.env`는 읽거나 고치지 말 것**(필요한 키 이름만 `.env.example`에 적기). 사용자에게 키를 채팅에 붙여 넣으라고 하지 않기.
2. **확인되지 않은 데이터는 만들지 않기.** 없으면 '정보 없음'. 실제로 확인되지 않은 게임 이미지·구매처 URL을 만들지 말 것(원래 요구사항).
3. AI 추정값은 항상 출처를 구분해 표시(`source: 'ai'` → 화면에 'AI 추정'). 회원 제보는 '사용자 제보 · 관리자 확인'.
4. `node_modules`, `.data`(회원 DB·업로드 이미지), `.cache`는 건드리지 않기(캐시 삭제가 필요하면 먼저 물어보기).
5. 기능을 바꾸면 테스트도 함께 고치고 `npm test`, `npm run test:e2e` 통과 확인.
6. `prefill:players`·`prefill:ended`·`import:status` 스크립트는 같은 파일(`server/data/party-size.json`)에 쓰므로 **동시에 두 개 돌리지 않기**. (`prefill:images`·`prefill:playtime`은 각자 다른 파일)
7. 미리 만드는 데이터(`server/data/*.json`)는 git 파일로 배포(Vercel에서 읽기만). Turso(회원 DB)에는 회원이 만드는 데이터만(사진 포함).
8. DB 호출은 모두 비동기(`await db.prepare(sql).get/all/run(...)`). 원격 DB는 외래 키(ON DELETE)를 믿지 않으므로 지울 때 자식 행을 직접 지우기(`accounts.deleteAccount`·`community.deleteReview`처럼 `db.batch`)

## 스택

- 서버: `node:http`(프레임워크 없음) — `server/index.js` → `server/app.js`(모든 API 라우트)
- DB: libSQL(`@libsql/client`, SQLite 호환, **비동기**) — 로컬 `.data/playpick.db`, 배포 Turso(`TURSO_DATABASE_URL`·`TURSO_AUTH_TOKEN`), 테스트 `:memory:`. 스키마·열 추가는 `server/db.js`(첫 요청 때 자동 생성·보충)
  - 업로드 사진(프로필 `u…`·제보 표지 `s…`·표지 사진 제보 `p…`)은 DB `images` 표(`avatars.js`). 예전 `.data/avatars` 파일은 로컬에서 읽기 전용으로 보임
  - 승인된 제보 목록 등은 30초 캐시(`community/cached.js`) — 서버리스 인스턴스가 여러 개라도 곧 반영
- 배포: Vercel — `api/index.js`(서버리스 함수가 `createApp`으로 넘김) + `vercel.json`(API·사진 주소 → 함수, 나머지 → `client/dist`). Vercel이면(`config.vercel`) 캐시 폴더 `/tmp`, IP는 `x-forwarded-for`, 게관위 색인 자동 갱신 끔
- 화면: React 19 + esbuild(`scripts/build.mjs`, `client/public` 파일은 `client/dist`로 평평하게 복사), 자체 라우터 `client/src/lib/router.jsx`
  - 뒤로 가기 복원: 기록 항목마다 키(`history.state.ppKey`)를 붙여 불러온 목록·'더 보기' 상태·스크롤 위치를 메모리에 저장(`lib/pageMemory.js`의 `usePageState`, `useAsync(fn, deps, memo)`). 상세의 '추천 목록으로'는 바로 앞이 그 목록이면 뒤로 가기(`goBackTo`). 새 목록 화면을 만들면 이 둘을 쓰기
  - 디자인: 콘솔 게임 스토어형(PlayStation 디자인 분석 바탕, 흰·검정 + 파랑 하나) + 다크 모드 — **`DESIGN.md`**. 색은 `styles.css`의 토큰(`--bg`, `--surface-2`, `--field` 등)만 쓰기(직접 hex 쓰면 다크 모드에서 깨짐). 헤더 `ThemeToggle.jsx`, 첫 테마는 `client/index.html` 스크립트
- 테스트: `node:test` 단위(`test/`), Playwright E2E(`e2e/`, 가짜 카탈로그 주입 방식)
  - 테스트 중에는 `.env`를 읽지 않음(`NODE_TEST_CONTEXT`, `server/config.js`). 테스트 서버는 항상 `dbFile: ':memory:'`
  - E2E의 '더 보기'는 `dispatchEvent('click')`으로 누르기(`click()`은 스크롤해서 자동 불러오기와 겹침)
- 요구: Node 22+

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` / `npm start` | 개발 서버 / 빌드 후 실행 (기본 포트 4000) |
| `npm run build` | 화면 빌드 |
| `npm test` / `npm run test:e2e` | 단위 / E2E 테스트 |
| `npm run check:apis` · `check:search` · `check:gemini` | 외부 API·검색·Gemini 모델 점검 |
| `npm run check:game -- <이름>` | 게임 하나가 왜 보이는지/숨겨지는지 진단(IGDB·게관위·AI 판단) |
| `npm run prefill:players -- [--igdb N] [--grac N] [--recheck] [--recheck-unknown] [--model M]` | AI 추천 인원·플레이 시간·게관위 서비스 상태 미리 저장 |
| `npm run prefill:players -- --grac-players [N]` | 화면에 보이는 게관위 게임에 **추천 인원만** 물어 채움(상태·플레이 시간 그대로). AI가 그 게임을 안다고(`known: true`) 할 때만 저장, 아니면 '모름' |
| `npm run prefill:ended -- [--igdb N] [--online N] [--only grac\|popular\|online] [--export] [--rescan]` | IGDB 게임 서비스 종료 여부 AI 확인(후보는 `.cache/ended-candidates.json`에 24시간 저장) |
| `npm run prefill:ended -- --sports [--dry]` | 해마다 나오는 스포츠 게임 옛 판의 **공식 온라인 서비스 종료** 여부 AI 확인(IGDB+게관위) → `sportsEnded`, 종료면 숨김 |
| `npm run prefill:ended -- --export --recheck-alive [--limit N]` | **서버가 필요한 온라인 게임**(MMO·배틀로얄·멀티 전용, 모드·플랫폼 정보 없는 PC·모바일) 중 외부 AI로 아직 확인 안 한 게임을 다시 내보냄(Gemini가 '서비스 중'이라 한 것 포함 — 최근 종료는 Gemini가 모름). 웹 검색 AI → `import:status` |
| `npm run prefill:images` | 게관위 모바일 게임 App Store 아이콘·스크린샷 저장 |
| `npm run prefill:playtime -- [--limit N] [--pages N] [--dry] [--retry]` | RAWG 평균 플레이 시간 저장(인기·랭킹·신작·장르별 IGDB 게임, 기본 500개). RAWG 월 2만 건·게임당 최대 2건 |
| `npm run recheck:grac-igdb -- [--limit N] [--dry]` | **화면에 보이는** 게관위 게임(종료·모름 제외, 약 9천 개, 동시 6묶음)이 IGDB에 있는지 새 방식(괄호 안 이름·플랫폼 표기 제거·전각 정리·slug, 꺼낸 이름은 플랫폼도 일치)으로 다시 확인 → `.cache/grac-igdb-check.json`(v2). 이어서 실행 가능 |
| `npm run refresh:grac -- [--incremental] [--skip-grac]` | **배포용 데이터 갱신**: 게관위 전체 목록 → `server/data/grac-index.json`, `.cache`의 IGDB 존재 확인·번역 캐시 → `server/data/`로 합쳐 복사. 돌린 뒤 커밋 |
| `npm run import:status -- <결과.csv>` | 외부 AI 결과(게관위 '모름'·IGDB 종료) 반영. `--dry`, `--force` |
| `npm run prefill:players -- --grac-players --export` | 게관위 게임 추천 인원 외부 AI용 CSV 내보내기 → `server/data/players-review/players-partN.csv`(300개씩) + `players.map.json`. 질문은 `PROMPT-PLAYERS.md` |
| `npm run import:players -- <결과.csv> [--dry] [--force]` | 외부 AI 추천 인원 결과 반영(`known: true`이고 1≤min≤max≤32만, 출처 `external`). 이미 숫자 있으면 건너뜀. 거의 다 1~1이면 '짐작' 경고 |

## 데이터 출처와 구조

- **IGDB**(주 데이터, 전체 게임 실시간 조회): `server/providers/igdbProvider.js` (Apicalypse, 초당 4회 제한 `slot()`)
  - 트레일러: IGDB `videos`(YouTube 영상 ID)에서 하나(`trailerOf`: 출시 → 공식 → trailer → 첫 영상, ID 모양 아니면 버림). 상세 '트레일러' 칸은 누르기 전엔 YouTube 미리보기 그림만, 누르면 `youtube-nocookie.com` 으로 재생. 게관위에는 영상이 없어 IGDB에 없는 게임은 칸 없음. 홈 첫 화면 큰 그림·인기 1위는 사진 대신 트레일러를 바로 소리 없이 반복 재생(`BackdropTrailer`, 멈춤·소리 단추 없음, 보일 때만·재생이 실제 시작돼야 사진을 덮음·동작 줄이기면 사진), 인기 2~6위는 마우스를 1.2초 올리면 팝업으로 재생(`TrailerPeek.jsx`, 마우스 기기만)
- **게임물관리위원회(게관위)**: 전체 목록 색인 `.cache/grac-index.json`(약 3.3만 건, 로컬은 매일 증분·주 1회 전체) + git 시드 `server/data/grac-index.json`(배포는 이것만 읽음, `refresh:grac`로 갱신), IGDB에 있는지 확인 캐시 `.cache/grac-igdb-check.json`(+ 시드 `server/data/`). IGDB에 없는 게관위 게임만 '게관위 카드'로 보임
  - 이름 맞추기(`igdbProvider.titleVariants`·`titleSlugs`, `catalog.createExistenceCache`): 'Portal 2(포탈 2)_PC' → Portal 2·포탈 2, 'Kartrider Drift' → slug kartrider-drift. 괄호 안 등 꺼낸 이름으로만 맞으면 플랫폼도 같아야 함(`samePlatform`)
- **RAWG**: 평균 플레이 시간 — 서버는 실시간으로 부르지 않고 `server/data/rawg-playtime.json`(`prefill:playtime`)만 읽음. 파일에 없으면 AI 추정 → '정보 없음' (2026-11 RAWG 서버 522 다운으로 상세가 8초씩 걸려서 바꿈) / **DeepL**: 소개 번역·검색어 번역 / **App Store 검색 API**: 게관위 모바일 게임 아이콘(이름+개발사 모두 일치할 때만)
- **Gemini**(기본 `gemini-flash-lite-latest`): 서버는 실시간으로 부르지 않고 **미리 저장한 파일만 읽음**
  - `server/data/party-size.json`: 추천 인원·플레이 시간·서비스 상태(게관위 `status`, IGDB `ended`)·근거
  - `server/data/app-store.json`: App Store 아이콘·스크린샷
  - `server/data/status-review/`: 외부 AI용 내보내기 CSV와 질문(PROMPT*.md), 결과 CSV
  - **예외: 상세 화면 AI 플레이 시간**(`server/services/aiPlaytime.js`) — 플레이 시간이 아무 데도 없는 게임을 **로그인한 회원**이 열면 화면이 `POST /api/games/:id/playtime`으로 그 게임 하나만 Gemini에 물어 DB `ai_playtime`에 저장(한 게임 한 번, '모름'도 저장). 로그인 안 하면 '로그인 후 확인' 안내. 하루 상한 `AI_PLAYTIME_DAILY_LIMIT`(기본 300), 회원당 시간당 30번, `AI_PLAYTIME_LIVE=off`로 끔. AI 오류·상한 초과는 저장 안 함
  - **예외: 상세 화면 AI 추천 인원**(`server/services/aiPlayers.js`) — 플레이 시간과 같은 방식. 추천 인원이 아무 데도 없는 게임(IGDB 협동 인원 없음 + `party-size.json`에 인원 숫자 없음 — 파일에서 '모름'이었던 게임도 한 번 더 물음)을 **로그인한 회원**이 열면 `POST /api/games/:id/players`로 그 게임 하나만 물어 DB `ai_players`(키 `partySize.cacheKey`)에 저장('모름'도). 저장된 값은 서버가 60초마다 읽어 `partySize.setAsked`로 **목록·추천에도** 'AI 추정'으로 붙임. 하루 상한 `AI_PLAYERS_DAILY_LIMIT`(기본 300), 회원당 시간당 30번, `AI_PLAYERS_ASK=off`로 끔(`AI_PLAYERS_LIVE`는 목록에서 묻는 예전 기능, 계속 끔)
  - **예외: 게관위 새 게임**(`server/services/gracNew.js`) — Vercel Cron(`vercel.json`, 매일 한국 시간 4시, `GET /api/cron/grac` + `Authorization: Bearer CRON_SECRET`) 또는 관리자 '게관위 새 게임' 탭 '지금 받기'로: 시드(`grac-index.json`)에 없는 새 등급분류 게임을 DB `grac_new`에 받고 → **스토어 근거**로 상태 판단(PC: Steam 검색·appdetails의 `coming_soon`, 모바일: App Store 이름+개발사 일치) → 찾은 게임만 스토어 설명·Steam 기능을 주고 Gemini가 추천 인원·플레이 시간(웹 검색 없음, Steam 기능이 싱글뿐이면 1~1, 멀티 기능인데 1명이면 모름 `fixByFeatures`) → DB `ai_grac`. 못 찾으면 7일마다 최대 4번 다시, 등급분류 180일 안이면 '새 등급분류'(`aiRecent`)로 보임. 아케이드·교육용·체험판·취소·`party-size.json`에 이미 있는 게임은 안 봄. 한 번에 최대 40개. 서버가 60초마다 DB를 읽어 색인(`gracIndex.setExtra`)·`partySize.setOverlay`에 덧붙임(파일 판단이 우선). `AI_GRAC_LIVE=off`면 스토어 근거만. 로컬 개발 서버는 켤 때 하루 지났으면 한 번 실행. (무료 Gemini 키는 Google 검색 연결이 막혀 스토어 근거 방식)
  - 플레이 시간 우선순위: 회원 정보 수정 제보 → **IGDB 이용자 기록(Time To Beat, 기록 3명 이상, 상세에서 실시간 조회·1000시간 넘는 값 버림)** → RAWG 파일 → AI 파일(`party-size.json`) → AI DB(`ai_playtime`) → 정보 없음 (`app.js`의 `playtimeOf`·`IGDB_TTB_MIN`)
- 서버가 켜져 있으면 데이터 파일 변경을 30초 안에 다시 읽음

### 목록에서 숨기는 규칙 (`server/app.js`의 `listable`)
- AI가 서비스 종료로 판단(`aiEnded`) 또는 회원 서비스 종료 제보 승인(`userEnded`) → 숨김
- **해마다 나오는 스포츠 게임(피파·PES·NBA 2K·매든·NHL·MLB·F1·WWE 등)의 옛 판**은 공식 온라인 서비스가 끝났으면 오프라인이 돼도 서비스 종료로 숨김(사용자 요청 2026-11-14, 피파 12·13·14 등). 제목으로 고르고(`partySize.isAnnualSports`, 게관위식 `XBOX 360_FIFA 16 (피파 16)`도) AI 판단은 `party-size.json`의 `sportsEnded` — `npm run prefill:ended -- --sports`(IGDB+게관위, 새 판이 나오면 다시 돌리기). 피파 온라인·모바일처럼 계속 서비스하는 게임은 해당 없음
- 게관위 게임: '출시 예정'은 출시 예정 목록에만. 기본으로 **AI가 '서비스 중'이라 했거나 App Store에 있을 때만** 보임(`HIDE_UNKNOWN_GRAC=off`면 '모름'도 보임). AI 데이터 파일이 없으면 숨기지 않음
- **아케이드 전용 게임(오락실·인형뽑기 기계) 숨김** — 사이트 목적(친구와 같이 할 게임)과 안 맞음. 플랫폼이 아케이드뿐일 때만(`taxonomy.isArcadeOnly`). 단 IGDB 본편이 오락실판인 고전 게임(철권 3·팩맨 등)은 가정용판(이식판·확장판·리마스터) 플랫폼을 `homePlatforms`로 붙여 보여 줌(`igdbToGame`, 평가 있는 아케이드 전용 181개 중 110개). 아케이드는 플랫폼 선택지·제보에서도 뺌(`hidden: true`), 예전 링크의 `platforms=arcade`는 조용히 무시
- **교육용 앱(게관위 장르 '교육용')·체험판(제목에 체험판·(Demo) 등)도 숨김** — `taxonomy.isOffTopic`(아케이드 전용 포함)으로 한 번에 판단
- IGDB 자체 상태(Offline 등)도 숨김
- **완전히 안 보이는 게임**(`app.js`의 `blockedReason`): 서비스 종료(AI·외부 AI 판단·회원 제보 승인·IGDB Offline) `ENDED` · 판매 중단(IGDB Delisted) `DELISTED` · 개발 취소(IGDB Cancelled) `CANCELLED` · 아케이드 기계 전용 `ARCADE` → 상세는 410 + 이유별 안내(**관리자만** 열림), 찜·최근 본 게임·내 리뷰·회원 평점 랭킹에서도 뺌(`withoutEnded`, 찜은 저장된 플랫폼으로 아케이드도). 교육용·체험판·'모름' 게관위 게임은 목록에서만 빠지고 상세는 열림

### 게임 정보에 덧붙이는 순서 (`decorate`)
`partySize.applyCached` → `appArt.applyAll`(App Store) → `imageSubs.applyAll`(승인된 표지 사진) → `reports.applyAll`(승인된 종료·정보 수정 제보) → 별점·찜

## 회원 기능 (`server/community/`)

- 문의 연락처: `InfoPages.jsx`의 `CONTACT_EMAIL`(개인정보처리방침·이용약관에 표시)
- 계정·세션·비밀번호 재설정(메일: Brevo), 찜, 별점·리뷰(1인 1리뷰, 수정 불가·삭제 후 재작성), 최근 본 게임
- **다른 계정으로 로그인(Google·Discord)** `oauth.js`(제공자 주소·코드 교환) + `accounts.oauth*`: 서버가 제공자로 보냈다가(`/api/auth/oauth/:p/start`) 돌아온 코드를 서버에서 바꿈(`…/callback`, state는 HttpOnly 쿠키 `pp_oauth`). 연결 표 `user_identities`(provider, subject)
  - 이미 연결 → 로그인 / **인증된** 같은 이메일 회원 → 그 계정에 연결 / 처음 → `/signup/social`에서 닉네임 정하기(`oauth_pending`, 쿠키 `pp_oauth_pending` 30분) / 인증 안 된 이메일 → 거절
  - 소셜로만 가입한 계정: 아이디 `g_…`·`d_…` 자동, `password_hash = ''`(`hasPassword: false`) → 비밀번호 '만들기'(현재 비밀번호 없이), 탈퇴는 '탈퇴'만, 아이디 찾기 메일은 '○○로 로그인' 안내
  - 마이페이지 '연결된 계정'(`/mypage/accounts`): 연결(`?mode=link`)·끊기(마지막 로그인 방법은 못 끊음). 오류는 `?oauthError=코드&provider=`로 돌아와 화면이 문구로 바꿈(`SocialLogin.jsx`의 `oauthErrorText`)
  - 키 `GOOGLE_CLIENT_ID/SECRET`·`DISCORD_CLIENT_ID/SECRET`(둘 다 있는 것만 버튼 보임). 돌아올 주소 `<APP_BASE_URL>/api/auth/oauth/<google|discord>/callback`을 각 콘솔에 등록. 테스트는 `deps.oauthFetch`·`deps.oauthEndpoints`로 가짜 제공자
- **회원 탈퇴**(`/mypage/delete`, `POST /api/me/delete`, 비밀번호(있으면) + '탈퇴' 입력): 검토 중인 제보·프로필 사진 파일을 지우고 `users` 행 삭제 → 세션·연결된 계정·찜·리뷰·최근 본 게임·알림도 삭제. 승인·거절된 제보와 리뷰 신고는 작성자만 NULL('(탈퇴한 회원)')
- **제보**(모두 로그인 필요, 관리자 승인 후 반영, 관리자가 직접 올리면 바로 승인)
  - **고쳐서 승인**: 게임 제보·정보 수정 제보는 관리자가 틀린 칸만 고쳐 승인(이미 승인된 것도 '고치기'). 회원이 낸 원래 값은 `original_json`·`original_payload`에, 바뀐 칸은 응답 `edited`(원래 → 반영)로 관리자 카드·회원 '내 제보'·알림에 보임. 표지 사진·서비스 종료 제보는 승인·거절만
  - 게임 제보 `submissions.js` → 승인 시 `user-<번호>` 게임
  - 표지 사진 제보 `imageSubmissions.js`(출처 주소 필수)
  - 서비스 종료 제보·정보 수정 제보(추천 인원·플레이 시간·구매처) `reports.js`
  - 리뷰 신고 `reports.js` → 관리자가 숨기면 작성자에게만 보이고 평점·칭호 계산에서 빠짐
- **관리자**: `.env`의 `ADMIN_EMAILS`(쉼표 구분) 이메일로 가입한 계정. 화면 `/admin`(제보 종류별 탭)
- **칭호·뱃지** `badges.js`: 저장 없이 그때그때 계산(대표 칭호 `users.title_badge`, 알림 확인 `users.badges_seen`)
  - 단계: 제보(finder~curator), 리뷰(rv1~rv5), 사진(ph1~ph3), 정보(if1~if3) + 특별 뱃지(pioneer, popular, thorough, local, early, essay, cleaner, firstword)
  - 그림 `client/public/badge-<id>.webp`(128px, 배경 투명). 그림이 없으면 `noImage: true`로 이모지 표시
  - 새 칭호 알림(토스트), 대표 칭호 고르기(`BadgePicker.jsx`: 마이페이지·홈 프로필 패널)
- **기여자 순위·내 기여** `contributors.js`(저장 없이 계산): 영향력 점수 = 승인 점수(게임 3·사진 2·정보 1) + 승인 뒤 다른 회원 반응(찜 1·리뷰 2·조회 10회당 1) × 내 몫(게임 100%·사진 50%·정보 25%, 종료 0), 게임당 한 달 20점 상한, 관리자 제외. 화면: 상단 메뉴 '명예의 전당'(`/hall-of-fame`, 이번 달/전체), 홈 'N월의 기여자' 줄, 내 제보 '내 기여가 만든 변화'(`/api/me/impact`)
  - 조회 수 `game_views`(한국 날짜별, 기여자가 있는 게임만, 같은 사람 하루 1번, 기여자 본인·관리자 제외). 이정표 알림(찜 5·10·50·100, 조회 50~1000, 첫 리뷰)은 `contrib_milestones`로 한 번만
- **알림** `notifications.js`(DB `notifications`, 회원당 최근 100개): 제보 승인·거절(사유)·승인 취소, 새 칭호, 리뷰 숨김·다시 보임, 찜한 게임 서비스 종료 승인, 가입 환영. 관리자 처리 라우트(`app.js`)에서 `beforeReview`→처리→`afterReview`로 넣음(본인 제보는 알림 없음). 화면 헤더 종 `NotificationBell.jsx`(화면 이동·60초마다 숫자만 받음), 관리자는 '검토 대기 N건' 줄
- **내 제보**(`MyPage.jsx` `SubmissionsSection`): 게임·표지 사진·종료·정보 수정 제보를 한 목록으로(상태 요약 카드·종류 칩으로 거르기)

## 남은 일 (우선순위)

1. **배포됨** — https://playpick-sooty.vercel.app (Vercel Hobby + Turso, main push → 자동 배포, 안내 `docs/deploy-plan.md`). 남은 확인: 관리자 이메일로 먼저 가입, 가입·로그인·찜·리뷰·사진 올리기·비밀번호 메일·`/admin`, 다시 배포해도 회원·사진이 남는지
2. GitHub: 공개 저장소 `jasonjoy132/playpick`(main). push 전 `git status`로 `.env`·`.data/`·`.cache/` 안 올라가는지 확인
3. (선택) 모바일 화면 점검, 게임 상세 페이지 제목·미리보기, 친구와 같이 고르는 '파티 투표'
