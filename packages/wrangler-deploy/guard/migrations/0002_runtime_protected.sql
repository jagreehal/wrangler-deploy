-- migrations/0002_runtime_protected.sql
CREATE TABLE IF NOT EXISTS runtime_protected (
  account_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (account_id, script_name)
);
CREATE INDEX IF NOT EXISTS idx_runtime_protected_added_at
  ON runtime_protected(added_at DESC);
