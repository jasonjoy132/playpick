# PlayPick 배포 계획 (보관 · 아직 진행 전)

무료로 배포: **Vercel Hobby + Turso 무료**. 사진도 Turso DB에 저장.

**비용 0원 원칙:** Vercel Hobby와 Turso Starter 둘 다 무료이고 카드 등록이 필요 없음. 유료로 넘어가는 옵션은 켜지 않음.
- 한도를 넘으면 요금이 나가는 대신 요청이 막힘. 과제 규모로는 한도에 닿지 않음. 정확한 한도는 가입 화면에서 확인.
- 사진 저장소(Vercel Blob)는 쓰지 않음. 사진이 작으므로(프로필 512KB, 제보 1.5MB 이하) **Turso DB 안에 BLOB으로** 저장해 서비스를 하나 줄임.

## 왜 이렇게 바꿔야 하나
Vercel은 서버리스라서 **디스크가 없음**. 쓸 수 있는 곳은 `/tmp`뿐이고, 그마저도 요청 사이에 사라질 수 있음.

| 지금 디스크에 쓰는 것 | Vercel에서 |
|---|---|
| 회원 DB `.data/playpick.db`(SQLite, 동기 호출 약 92곳) | **Turso**(SQLite와 같은 SQL)로. 호출은 `await`로 바꿈 |
| 업로드 사진 `.data/avatars`, `submission-images` | **Turso DB의 `images` 테이블**(BLOB)로 |
| `.cache/grac-index.json`(게관위 3.3만 건) | 미리 받아 **git 파일**(`server/data/grac-index.json`)로. 실행 중 추가분은 `/tmp` |
| `.cache/grac-igdb-check.json`, `translations.json` | 시드를 git에 넣고, 새로 생긴 것은 `/tmp`(사라져도 다시 계산함) |
| `server/data/*.json` 쓰기(스크립트용) | Vercel에서는 읽기만 함(지금도 그럼) |

**Supabase 대신 Turso를 고른 이유:**
- SQL 문법(`?`, `INSERT OR IGNORE`, `AUTOINCREMENT`, `COLLATE NOCASE`)을 그대로 쓸 수 있어서, 바꿀 것은 동기 → 비동기 하나뿐임.
- `@libsql/client`가 `file:`·`:memory:`를 지원해서, 로컬 개발과 테스트도 같은 코드로 돌아감.
- Supabase 무료는 일주일 동안 안 쓰면 멈춤.

## 1. DB를 비동기로 (가장 큰 작업)
- 새 의존성 `@libsql/client`를 추가함.
- `server/db.js`: `DatabaseSync` 대신 `createClient({ url, authToken })`을 씀.
  - `url`은 `TURSO_DATABASE_URL`, 없으면 `file:.data/playpick.db`. 테스트는 `:memory:`.
  - 도우미 `db.get/all/run`을 만들고, 스키마 생성은 시작할 때 `await ensureSchema()` 한 번.
- 고칠 곳: `server/community/*.js`, `server/services/aiPlaytime.js`, 그리고 이것들을 부르는 `server/app.js` 라우트(전부 `await`).
- 목록 계산(`decorate`)에서 게임마다 DB를 부르지 않게 한 번에 모아서 부름.

## 2. 사진 → DB 안에 저장
- 스키마에 `images(name TEXT PRIMARY KEY, mime TEXT, data BLOB, created_at)`를 추가함.
- `avatars.js`의 `createAvatarStore`는 파일 대신 DB에 씀. 파일 이름 규칙과 형식 검사는 그대로 둠.
- `serveAvatar`는 같은 주소로 DB에서 읽어 보내고, `Cache-Control: public, max-age=31536000, immutable`을 붙임.

## 3. 서버를 서버리스 함수로
- `api/index.js`: `createApp`으로 만든 서버를 재사용하고 `(req, res) => server.emit('request', req, res)`를 내보냄.
- `vercel.json`
  - `buildCommand: npm run build`, `outputDirectory: client/dist`
  - rewrites: `/api/(.*)` 등 → 함수, 나머지 → `/index.html`
  - `includeFiles: server/data/**`, `maxDuration: 60`, `regions: ["icn1"]`
- `config.js`: Vercel이면 캐시 폴더를 `/tmp`로 하고, 프록시 IP는 `x-forwarded-for`에서 읽음(`app.js`의 `req.socket.remoteAddress` 대신).
- 게관위 색인은 git 파일을 먼저 읽고 `/tmp`의 증분을 얹음. 전체 갱신은 로컬에서 하고 커밋함(`npm run refresh:grac`).
- 메모리 기반 요청 제한은 인스턴스마다 따로 걸림. 과제용이라 허용.

## 4. 데이터 준비 (로컬)
- 로컬 `.cache/grac-index.json`에 42건뿐이므로, 게관위 전체를 다시 받아 `server/data/`에 커밋함.
- `grac-igdb-check.json`과 `translations.json`도 시드로 커밋함. `.cache`에서 읽어서 복사만 함.
- 회원 DB는 새로 시작함.

## 5. 사용자가 직접 할 일
1. **Turso:** GitHub로 가입 → DB 생성(지역 도쿄) → URL과 토큰 발급.
2. **Vercel:** GitHub로 가입(Hobby) → `jasonjoy132/playpick` Import. 카드 등록과 Pro 체험은 하지 않음.
3. **Environment Variables**에 직접 입력(채팅에 붙여 넣지 않기).
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
   - `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `DEEPL_API_KEY`
   - `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `GEMINI_API_KEY`, `ADMIN_EMAILS`
   - `DATA_SOURCE=live`, `APP_BASE_URL=https://<프로젝트>.vercel.app`, `MAIL_DEV_LOG=false`
4. 배포가 끝나면 `ADMIN_EMAILS`의 이메일로 먼저 가입함.

## 6. 문서·기타
- `.env.example`에 `TURSO_*`를 추가함.
- 개인정보처리방침의 '처리 위탁'에 Vercel(호스팅)과 Turso(회원 DB·사진)를 추가함.
- CLAUDE.md의 스택·남은 일·규칙 7을 갱신함.

## 위험과 대응
| 위험 | 대응 |
|---|---|
| 콜드 스타트가 느림(`party-size.json` 10MB 등) | 한 번만 읽고 재사용함. 느리면 파일을 줄임 |
| `/tmp` 캐시가 사라져 IGDB 호출이 늘어남 | 시드 파일로 대부분 해결. 429 재시도 처리 확인 |
| 게관위 API를 Vercel에서 부를 수 있는지 모름 | 서울 지역을 씀. 안 되면 git 색인만 쓰고 로컬에서 갱신 |
| Turso 왕복이 쌓임 | DB 호출을 모아서 부름 |
| 무료 DB가 오래 안 쓰이면 잠들 수 있음 | 가입할 때 정책 확인 |

→ main에 바로 올리지 않음. 브랜치를 push해서 **미리 보기 주소**에서 확인한 뒤 합침.

## 배포 후 작업 흐름
- GitHub를 연결하면 **main에 push → 자동 배포**, 다른 브랜치에 push → 미리 보기 주소.
- 자동으로 되지 않는 것:
  - 새 환경 변수는 Vercel 대시보드에 직접 추가해야 함.
  - 테스트(`npm test`, `npm run test:e2e`)는 push 전에 로컬에서 돌림.
  - 미리 만드는 데이터는 커밋해야 반영됨.

## 확인
- 테스트 통과 → 미리 보기 주소에서 다음을 확인:
  - 홈, 추천 목록, 상세, 검색
  - 가입·로그인, 찜, 리뷰, 사진 업로드
  - 비밀번호 메일, `/admin`
  - 다크 모드, 모바일 폭, 첫 요청 속도
- 다시 배포한 뒤에도 회원과 사진이 남는지 확인함.
