// 회원 DB (libSQL = SQLite 호환). 로컬은 파일(.data/playpick.db, git 제외), 배포(Vercel)는 Turso 원격 DB
//  - 회원·세션·비밀번호 재설정·찜·리뷰·제보·알림·업로드 사진을 저장
//  - 모든 호출은 비동기: db.prepare(sql).get/all/run(...) 이 Promise 를 돌려줌
//  - 원격 DB는 요청마다 연결이 달라 외래 키(ON DELETE)를 믿지 않음 → 지울 때 자식 행을 직접 지움(accounts.deleteAccount 등)
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  platforms TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_game ON reviews(game_id);
CREATE TABLE IF NOT EXISTS recent_views (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_views(user_id, viewed_at);
-- 회원 게임 제보 (관리자가 승인하면 게임으로 추가, id = user-<번호>)
CREATE TABLE IF NOT EXISTS game_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  title TEXT NOT NULL,
  original_title TEXT,
  publisher TEXT,
  release_year INTEGER,
  platforms TEXT NOT NULL,
  genres TEXT NOT NULL,
  players_min INTEGER,
  players_max INTEGER,
  store_url TEXT,
  summary TEXT,
  image_file TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON game_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON game_submissions(user_id, created_at);
CREATE TABLE IF NOT EXISTS image_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  game_id TEXT NOT NULL,
  game_title TEXT NOT NULL,
  image_file TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_image_subs_status ON image_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_image_subs_user ON image_submissions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_image_subs_game ON image_submissions(game_id, status);
-- 서비스 종료 제보(kind=ended)·정보 수정 제보(kind=fix): 승인되면 게임 정보에 반영
CREATE TABLE IF NOT EXISTS game_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ended', 'fix')),
  game_id TEXT NOT NULL,
  game_title TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  source_url TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_game_reports_status ON game_reports(kind, status, created_at);
CREATE INDEX IF NOT EXISTS idx_game_reports_user ON game_reports(user_id, created_at);
-- 리뷰 신고: 관리자가 확인해 숨기거나(upheld) 문제 없음(dismissed)
CREATE TABLE IF NOT EXISTS review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'dismissed')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  UNIQUE (review_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status, created_at);
-- 상세 화면에서 로그인한 회원이 열 때 AI에게 물은 플레이 시간 (한 게임 한 번만, hours NULL = AI가 모름)
CREATE TABLE IF NOT EXISTS ai_playtime (
  game_id TEXT PRIMARY KEY,
  hours INTEGER,
  model TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_playtime_created ON ai_playtime(created_at);
-- 상세 화면에서 로그인한 회원이 열 때 AI에게 물은 추천 인원 (key = partySize.cacheKey, 한 게임 한 번만, min NULL = AI가 모름)
CREATE TABLE IF NOT EXISTS ai_players (
  key TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  min INTEGER,
  max INTEGER,
  model TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_players_created ON ai_players(created_at);
-- 알림 (제보 승인·거절, 리뷰 숨김, 새 칭호 등). tone: ok | no | badge | wish | warn | info
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
-- 게임 상세 조회 수 (한국 날짜별, 기여한 회원이 있는 게임만, 같은 사람 하루 1번) — 기여자 순위·내 기여 요약용
CREATE TABLE IF NOT EXISTS game_views (
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, day)
);
-- 기여자 이정표 알림(찜 5명·조회 100회·첫 리뷰 등)을 보낸 기록: 같은 알림은 한 번만
CREATE TABLE IF NOT EXISTS contrib_milestones (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  level INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id, kind, level)
);
-- 다른 계정으로 로그인(Google·Discord): 제공자 계정 번호(subject) ↔ 회원
CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);
-- 처음 온 소셜 계정: 닉네임을 정할 때까지 잠시 보관(30분)
CREATE TABLE IF NOT EXISTS oauth_pending (
  token_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  next TEXT,
  expires_at INTEGER NOT NULL
);
-- 게관위 새 게임(시드 이후 새로 등급분류된 것): 하루 한 번 받아 둠 (services/gracNew.js)
CREATE TABLE IF NOT EXISTS grac_new (
  rating_no TEXT PRIMARY KEY,
  game_json TEXT NOT NULL,
  rated_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
-- 새 게임 판단: 스토어(Steam·App Store)에서 찾은 근거 + AI 추천 인원. status NULL = 못 찾음(next_check 에 다시)
CREATE TABLE IF NOT EXISTS ai_grac (
  key TEXT PRIMARY KEY,
  status TEXT,
  min INTEGER,
  max INTEGER,
  hours INTEGER,
  model TEXT,
  evidence TEXT,
  store_url TEXT,
  store_name TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  next_check INTEGER,
  judged_at TEXT NOT NULL
);
-- 정기 작업 마지막 실행
CREATE TABLE IF NOT EXISTS sync_runs (
  name TEXT PRIMARY KEY,
  last_at TEXT NOT NULL,
  note TEXT
);
-- 업로드 사진(프로필·제보 표지·표지 사진 제보). 서버리스(Vercel)에는 디스크가 없어 DB 안에 저장
CREATE TABLE IF NOT EXISTS images (
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
`;

// 기존 DB 파일에 나중에 추가된 열 보충
const COLUMNS = [
  ['users', 'avatar_file', 'TEXT'],
  ['users', 'title_badge', 'TEXT'],
  ['users', 'badges_seen', 'TEXT'],
  ['reviews', 'game_title', 'TEXT'],
  ['reviews', 'game_image', 'TEXT'],
  ['reviews', 'hidden_at', 'TEXT'], // 신고로 숨긴 리뷰
  ['game_submissions', 'original_json', 'TEXT'], // 관리자가 고쳐서 승인했을 때 회원이 낸 원래 값
  ['game_reports', 'original_payload', 'TEXT'], // 관리자가 고쳐서 승인한 정보 수정 제보의 원래 값
];

/**
 * @param {string} target  ':memory:' | 파일 경로 | libsql://… (Turso)
 * @param {{ authToken?: string }} [opt]
 */
export function openDb(target, { authToken } = {}) {
  const remote = /^(libsql|https?|wss?):/.test(target);
  let url = target;
  if (!remote && target !== ':memory:') {
    const file = target.replace(/^file:/, '');
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    url = `file:${file}`;
  }
  const client = createClient({ url, authToken: authToken || undefined, intMode: 'number' });
  let ready = null;
  /** 처음 한 번: 표 만들기·나중에 추가된 열 보충 */
  const init = () =>
    (ready ??= (async () => {
      if (!remote) await client.execute('PRAGMA foreign_keys = ON');
      if (!remote && target !== ':memory:') await client.execute('PRAGMA journal_mode = WAL');
      await client.executeMultiple(SCHEMA);
      for (const [table, col, type] of COLUMNS) {
        const { rows } = await client.execute(`PRAGMA table_info(${table})`);
        if (!rows.some((c) => c.name === col)) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }
    })().catch((e) => {
      ready = null; // 실패하면 다음 요청에서 다시 시도
      throw e;
    }));
  const args = (a) => a.map((v) => (v === undefined ? null : v));
  const exec = async (sql, a) => {
    await init();
    return client.execute({ sql, args: args(a) });
  };
  return {
    remote,
    ready: init,
    /** node:sqlite 와 같은 모양(get/all/run)이지만 모두 Promise */
    prepare: (sql) => ({
      get: async (...a) => (await exec(sql, a)).rows[0],
      all: async (...a) => (await exec(sql, a)).rows,
      run: async (...a) => {
        const r = await exec(sql, a);
        return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
      },
    }),
    /** 여러 문장을 한 번에(트랜잭션). list: [[sql, args?], …] */
    async batch(list) {
      await init();
      return client.batch(list.map(([sql, a = []]) => ({ sql, args: args(a) })), 'write');
    },
    close: () => client.close(),
  };
}
