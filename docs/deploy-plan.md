# PlayPick 배포 (Vercel Hobby + Turso, 무료)

**비용 0원 원칙:** Vercel Hobby와 Turso 무료 요금제만 씀. 카드 등록과 유료 옵션(Pro 체험 등)은 하지 않음. 한도를 넘으면 요금이 나가지 않고 요청이 막힘.

## 코드 준비 (끝남, `deploy` 브랜치)
| 바꾼 것 | 내용 |
|---|---|
| 회원 DB | `node:sqlite` → libSQL(`@libsql/client`, 비동기). 로컬은 파일, 배포는 Turso, 테스트는 `:memory:` |
| 업로드 사진 | 디스크 대신 DB `images` 표 |
| 외래 키 | 원격 DB에서는 믿지 않음. 탈퇴·리뷰 삭제 때 자식 행을 직접 지움 |
| 서버 | `api/index.js`(서버리스 함수) + `vercel.json`(API·사진은 함수로, 나머지 화면은 `client/dist`) |
| 캐시 | Vercel이면 `/tmp`. 시작값은 git 파일 `server/data/`(게관위 목록·IGDB 확인·번역) |
| 게관위 목록 | 배포에서는 갱신하지 않음. 로컬에서 `npm run refresh:grac` → 커밋 |
| IP | Vercel이면 `x-forwarded-for` 첫 값(요청 제한·조회 수) |
| 문서 | `.env.example`에 `TURSO_*`, 개인정보처리방침 처리 위탁에 Vercel·Turso |

## 사용자가 직접 할 일
키·토큰은 **채팅에 붙여 넣지 말고** 각 사이트 화면에 직접 입력.

1. **Turso**
   - turso.tech → GitHub로 가입(무료).
   - DB 만들기: 이름 예 `playpick`, 지역은 **도쿄(aws-ap-northeast-1)**.
   - DB 화면에서 **주소**(`libsql://…`)와 **토큰**(Create Token, 읽기·쓰기)을 받음.
2. **Vercel**
   - vercel.com → GitHub로 가입(Hobby).
   - Add New → Project → `jasonjoy132/playpick` Import.
   - Framework는 Other, 나머지 설정은 `vercel.json`이 정하므로 그대로 둠.
3. **Environment Variables** (Import 화면 또는 Settings → Environment Variables)
   | 이름 | 값 |
   |---|---|
   | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | 1번에서 받은 값 |
   | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `DEEPL_API_KEY`, `GEMINI_API_KEY` | 로컬 `.env`와 같은 값 |
   | `BREVO_API_KEY`, `MAIL_FROM_EMAIL` | 로컬 `.env`와 같은 값 |
   | `ADMIN_EMAILS` | 관리자 이메일 |
   | `DATA_SOURCE` | `live` |
   | `APP_BASE_URL` | `https://<프로젝트 이름>.vercel.app` (첫 배포 뒤 주소 확인하고 넣고 다시 배포) |
   | `MAIL_DEV_LOG` | `false` |
4. **배포**
   - `deploy` 브랜치를 push하면 **미리 보기 주소**가 생김 → 아래 '확인' 목록을 봄.
   - 문제가 없으면 main에 합침 → main push가 실제 주소로 자동 배포.
5. 배포가 끝나면 `ADMIN_EMAILS`의 이메일로 **먼저** 가입함(다른 사람이 같은 이메일로 가입하지 못하게).

## 확인 (미리 보기 주소)
- 홈, 나만의 게임 찾기·추천 목록, 상세, 검색(최근 검색어)
- 가입·로그인, 찜, 리뷰, 프로필 사진·제보 사진 올리기
- 비밀번호 재설정 메일, `/admin` 승인, 명예의 전당, 탈퇴
- 다크 모드, 모바일 폭, 첫 요청 속도(콜드 스타트)
- 다시 배포한 뒤에도 회원·사진이 남아 있는지

## 배포 후 작업 흐름
- main에 push → 자동 배포. 다른 브랜치 push → 미리 보기 주소.
- push 전에 로컬에서 `npm test`, `npm run test:e2e`.
- 새 환경 변수는 Vercel 대시보드에 직접 추가.
- 미리 만드는 데이터(`server/data/*.json`)는 커밋해야 반영. 게관위 목록은 가끔 `npm run refresh:grac` → 커밋.

## 위험과 대응
| 위험 | 대응 |
|---|---|
| 콜드 스타트가 느림(JSON 약 25MB 읽기) | 인스턴스마다 한 번만 읽고 재사용. 느리면 배포용으로 필요한 칸만 남긴 파일을 만듦 |
| Turso 왕복이 쌓여 느림 | 함수(서울 icn1)와 DB(도쿄)를 가깝게. 뱃지 등은 조회를 동시에 |
| `/tmp` 캐시가 사라져 IGDB 호출이 늘어남 | 시드 파일로 대부분 해결 |
| 메모리 기반 요청 제한·조회 수 중복 제거가 인스턴스마다 따로 | 과제 규모라 허용 |
| 승인한 제보가 다른 인스턴스에 늦게 보임 | 최대 30초 |
