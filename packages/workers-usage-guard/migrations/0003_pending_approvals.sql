-- migrations/0003_pending_approvals.sql
CREATE TABLE IF NOT EXISTS pending_approvals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  breach_key TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TEXT,
  decided_by TEXT,
  rule_id TEXT NOT NULL,
  breach_type TEXT NOT NULL,
  actual_value REAL NOT NULL,
  limit_value REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_status_account
  ON pending_approvals(account_id, status, created_at DESC);
