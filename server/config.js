// 환경 변수 로딩 (외부 의존성 없이 .env 파싱)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 실행 중 쓰는 캐시 폴더: 로컬 .cache, Vercel(디스크 읽기 전용)은 /tmp (인스턴스가 바뀌면 사라짐 → server/data 시드 파일로 시작)
const cacheDir = process.env.VERCEL ? '/tmp/playpick-cache' : path.join(root, '.cache');
const seed = (name) => path.join(root, 'server', 'data', name);

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}
// 테스트(node --test)에서는 실제 .env(API 키 등)를 읽지 않음 → PC마다 설정이 달라도 같은 결과
if (!process.env.NODE_TEST_CONTEXT) loadDotEnv(path.join(root, '.env'));

const env = (k, d = '') => (process.env[k] ?? d).trim();
const int = (k, d) => {
  const n = Number.parseInt(env(k), 10);
  return Number.isFinite(n) ? n : d;
};

export function getConfig() {
  return {
    root,
    port: int('PORT', 4000),
    dataSource: env('DATA_SOURCE', 'demo') === 'live' ? 'live' : 'demo',
    // 회원·찜·리뷰 저장 파일 (SQLite)
    dbFile: env('DB_FILE') || path.join(root, '.data', 'playpick.db'),
    // 배포: Turso 원격 DB (있으면 dbFile 대신 사용)
    turso: { url: env('TURSO_DATABASE_URL'), authToken: env('TURSO_AUTH_TOKEN') },
    // Vercel(서버리스)에서 실행 중인지: 디스크 대신 /tmp, 프록시 IP 헤더 사용
    vercel: Boolean(process.env.VERCEL),
    // 비밀번호 재설정 메일의 링크 주소
    baseUrl: env('APP_BASE_URL') || `http://localhost:${int('PORT', 4000)}`,
    // 관리자: 이 이메일로 가입한 계정 (쉼표로 여러 개). 게임 제보 승인·거절 화면을 볼 수 있음
    // 게임위 게임 중 AI가 상태를 '모름'이라고 한 게임을 목록에서 숨길지 (기본 숨김, off 면 보임)
    hideUnknownGrac: env('HIDE_UNKNOWN_GRAC', 'on') !== 'off',
    adminEmails: env('ADMIN_EMAILS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    // 다른 계정으로 로그인. 둘 다 있어야 그 버튼이 보임. 돌아올 주소: <APP_BASE_URL>/api/auth/oauth/<google|discord>/callback
    oauth: {
      google: { clientId: env('GOOGLE_CLIENT_ID'), clientSecret: env('GOOGLE_CLIENT_SECRET') },
      discord: { clientId: env('DISCORD_CLIENT_ID'), clientSecret: env('DISCORD_CLIENT_SECRET') },
    },
    mail: {
      apiKey: env('BREVO_API_KEY'),
      fromEmail: env('MAIL_FROM_EMAIL'),
      fromName: env('MAIL_FROM_NAME', 'PlayPick'),
      devLog: env('MAIL_DEV_LOG') === 'true',
    },
    grac: {
      url: env('GRAC_API_URL', 'https://www.grac.or.kr/WebService/GameSearchSvc.asmx/game'),
      display: Math.min(Math.max(int('GRAC_DISPLAY', 1000), 1), 1000),
      maxPages: Math.max(int('GRAC_MAX_PAGES', 1), 1),
      startDate: env('GRAC_START_DATE'),
      endDate: env('GRAC_END_DATE'),
      cacheTtlSec: int('GRAC_CACHE_TTL', 3600),
      // 나만의 게임 찾기: IGDB에 없는 게임위 게임도 찾기 위한 전체 목록 색인 (GRAC_INDEX=off 로 끔)
      indexEnabled: env('GRAC_INDEX', 'on') !== 'off',
      indexFile: path.join(cacheDir, 'grac-index.json'),
      indexSeed: seed('grac-index.json'),
      igdbCheckFile: path.join(cacheDir, 'grac-igdb-check.json'),
      igdbCheckSeed: seed('grac-igdb-check.json'),
    },
    igdb: {
      clientId: env('IGDB_CLIENT_ID'),
      clientSecret: env('IGDB_CLIENT_SECRET'),
      // 목록에서 숨길 IGDB 게임 상태(쉼표 구분). 기본: Offline(서비스 종료)
      hiddenStatuses: (env('IGDB_HIDE_STATUSES', 'Offline') || 'Offline').split(',').map((x) => x.trim()).filter(Boolean),
    },
    appStore: {
      // 게임위 전용 게임의 이미지·App Store 링크 보완 (키 불필요). false 로 끌 수 있음
      enabled: env('APPSTORE_LOOKUP', 'true') !== 'false',
      // 미리 받아 둔 아이콘 (npm run prefill:images)
      artFile: path.join(root, 'server', 'data', 'app-store.json'),
    },
    rawg: {
      // 키는 npm run prefill:playtime 을 돌릴 때만 필요. 서버는 아래 파일만 읽음
      apiKey: env('RAWG_API_KEY'),
      dataFile: path.join(root, 'server', 'data', 'rawg-playtime.json'),
    },
    // 추천 인원 AI 추정 (Google Gemini). 키가 없으면 AI 없이 IGDB 값만 사용
    gemini: {
      apiKey: env('GEMINI_API_KEY'),
      model: env('GEMINI_MODEL', 'gemini-flash-lite-latest'),
      // 미리 정리한 추천 인원 (npm run prefill:players 로 만듦, git 에 올려 팀원과 공유 가능)
      dataFile: path.join(root, 'server', 'data', 'party-size.json'),
      legacyCacheFile: path.join(cacheDir, 'ai-players.json'),
      // on 이면 정리 안 된 게임을 검색할 때 그때그때 AI에게 물음(느릴 수 있음). 기본 끔
      live: env('AI_PLAYERS_LIVE', 'off') === 'on',
    },
    // 상세 화면 AI 플레이 시간: 로그인한 회원이 플레이 시간 없는 게임을 열면 그 자리에서 물어 DB에 저장 (off 로 끔)
    aiPlaytime: {
      apiKey: env('GEMINI_API_KEY'),
      model: env('GEMINI_MODEL', 'gemini-flash-lite-latest'),
      live: env('AI_PLAYTIME_LIVE', 'on') !== 'off',
      dailyLimit: Math.max(int('AI_PLAYTIME_DAILY_LIMIT', 300), 0),
    },
    deepl: {
      apiKey: env('DEEPL_API_KEY'),
      apiUrl: env('DEEPL_API_URL'),
      cacheFile: path.join(cacheDir, 'translations.json'),
      seedFile: seed('translations.json'),
    },
    krGameDb: {
      url: env('KR_GAME_DB_API_URL'),
      key: env('KR_GAME_DB_API_KEY'),
    },
  };
}
