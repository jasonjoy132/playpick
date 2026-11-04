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
`;

// 기존 DB 파일에 나중에 추가된 열 보충
const COLUMNS = [
  ['users', 'avatar_file', 'TEXT'],
  ['users', 'title_badge', 'TEXT'],
  ['users', 'badges_seen', 'TEXT'],
  ['reviews', 'game_title', 'TEXT'],
  ['reviews', 'game_image', 'TEXT'],
  ['reviews', 'hidden_at', 'TEXT'], // 신고로 숨긴 리뷰
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
