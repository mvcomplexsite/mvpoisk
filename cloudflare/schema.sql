PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_sub TEXT NOT NULL UNIQUE,
  telegram_id TEXT,
  telegram_name TEXT,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'web',
  device_name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oauth_flows (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_flows_expires_at ON oauth_flows(expires_at);

CREATE TABLE IF NOT EXISTS auth_handoffs (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_handoffs_expires_at ON auth_handoffs(expires_at);

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tv_pairs (
  pair_code TEXT PRIMARY KEY,
  claim_secret_hash TEXT NOT NULL,
  device_token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL DEFAULT 'MVPoisk TV',
  user_id TEXT,
  profile_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tv_pairs_device_token_hash ON tv_pairs(device_token_hash);
CREATE INDEX IF NOT EXISTS idx_tv_pairs_user_id ON tv_pairs(user_id);
CREATE INDEX IF NOT EXISTS idx_tv_pairs_expires_at ON tv_pairs(expires_at);
