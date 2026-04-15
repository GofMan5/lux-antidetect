import Database from 'better-sqlite3'
import { join } from 'path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK(protocol IN ('http','https','socks4','socks5')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    password TEXT,
    last_check TEXT,
    check_ok INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    browser_type TEXT NOT NULL CHECK(browser_type IN ('chromium','firefox','edge')),
    group_name TEXT,
    tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','starting','running','stopping','error')),
    proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT
);

CREATE TABLE IF NOT EXISTS fingerprints (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL,
    platform TEXT NOT NULL,
    hardware_concurrency INTEGER NOT NULL DEFAULT 4,
    device_memory INTEGER NOT NULL DEFAULT 8,
    languages TEXT NOT NULL DEFAULT '["en-US","en"]',
    screen_width INTEGER NOT NULL,
    screen_height INTEGER NOT NULL,
    color_depth INTEGER NOT NULL DEFAULT 24,
    pixel_ratio REAL NOT NULL DEFAULT 1.0,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    canvas_noise_seed INTEGER NOT NULL,
    webgl_vendor TEXT NOT NULL,
    webgl_renderer TEXT NOT NULL,
    audio_context_noise REAL NOT NULL DEFAULT 0.00001,
    fonts_list TEXT NOT NULL,
    webrtc_policy TEXT NOT NULL DEFAULT 'disable_non_proxied_udp',
    video_inputs INTEGER NOT NULL DEFAULT 1,
    audio_inputs INTEGER NOT NULL DEFAULT 1,
    audio_outputs INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_name);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_proxy ON profiles(proxy_id);
`

export function initDatabase(userDataPath: string): Database.Database {
  const dbPath = join(userDataPath, 'lux.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  // Migration: widen status CHECK constraint if needed (old: ready/running/error → new: +starting/stopping)
  // SQLite can't ALTER CHECK constraints, so we recreate the table if the old constraint exists.
  try {
    db.prepare("UPDATE profiles SET status = 'starting' WHERE 0").run()
  } catch {
    // CHECK constraint rejects 'starting' → need migration
    db.pragma('foreign_keys = OFF')
    db.exec(`
      BEGIN;
      CREATE TABLE profiles_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          browser_type TEXT NOT NULL CHECK(browser_type IN ('chromium','firefox','edge')),
          group_name TEXT,
          tags TEXT DEFAULT '[]',
          notes TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','starting','running','stopping','error')),
          proxy_id TEXT REFERENCES proxies(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used TEXT
      );
      INSERT INTO profiles_new SELECT * FROM profiles;
      DROP TABLE profiles;
      ALTER TABLE profiles_new RENAME TO profiles;
      CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_name);
      CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
      CREATE INDEX IF NOT EXISTS idx_profiles_proxy ON profiles(proxy_id);
      COMMIT;
    `)
    db.pragma('foreign_keys = ON')
  }

  // Migration: add start_url, group_color columns to profiles
  try {
    db.prepare("SELECT start_url FROM profiles LIMIT 0").get()
  } catch {
    db.exec(`ALTER TABLE profiles ADD COLUMN start_url TEXT DEFAULT ''`)
  }
  try {
    db.prepare("SELECT group_color FROM profiles LIMIT 0").get()
  } catch {
    db.exec(`ALTER TABLE profiles ADD COLUMN group_color TEXT`)
  }

  // Create session_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_history (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      duration_seconds INTEGER,
      exit_code INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_session_history_profile ON session_history(profile_id);
    CREATE INDEX IF NOT EXISTS idx_session_history_started ON session_history(started_at);
  `)

  // Create templates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      browser_type TEXT NOT NULL CHECK(browser_type IN ('chromium','firefox','edge')),
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  return db
}
