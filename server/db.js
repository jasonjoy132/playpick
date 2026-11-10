// SQLite 저장소 (Node.js 내장 node:sqlite — 별도 설치 불필요, Node 22.13 이상)
// 회원·세션·비밀번호 재설정·찜·리뷰를 저장합니다. 파일: .data/playpick.db (git 제외)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  for (const [table, col, type] of COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  return db;
}
