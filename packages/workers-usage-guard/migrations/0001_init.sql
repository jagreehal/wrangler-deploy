-- migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS overage_state (
  breach_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  breach_type TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  cooldown_until TEXT NOT NULL,
  grace_until TEXT,
  workflow_instance_id TEXT
);

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  script_name TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  requests INTEGER NOT NULL,
  cpu_ms INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_script_time
  ON usage_snapshots(account_id, script_name, captured_at DESC);

CREATE TABLE IF NOT EXISTS breach_forensics (
  id TEXT PRIMARY KEY,
  breach_key TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  graphql_response_json TEXT NOT NULL,
  actions_taken_json TEXT,
  estimated_savings_usd REAL
);

CREATE TABLE IF NOT EXISTS usage_reports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS notification_dedupe (
  dedup_key TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (dedup_key, channel_name)
);
CREATE INDEX IF NOT EXISTS idx_dedupe_sent_at ON notification_dedupe(sent_at DESC);
