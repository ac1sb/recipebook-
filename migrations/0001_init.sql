-- Recipe library for The Borsari Kitchen on Cloudflare D1.
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  data TEXT NOT NULL -- the whole library entry as JSON
);
CREATE INDEX IF NOT EXISTS entries_source_id ON entries (source_id);
CREATE INDEX IF NOT EXISTS entries_saved_at ON entries (saved_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
