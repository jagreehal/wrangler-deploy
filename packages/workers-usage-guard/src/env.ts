// src/env.ts
// Wrangler env binding. Secrets and vars listed here must match wrangler.jsonc.

export type Env = {
  // bindings
  DB: D1Database;
  OVERAGE_WORKFLOW: Workflow;

  // vars
  ACCOUNTS_JSON: string;
  NOTIFICATIONS_JSON: string;
  REQUEST_THRESHOLD: string;
  CPU_TIME_THRESHOLD_MS: string;
  OVERAGE_COOLDOWN_SECONDS: string;
  OVERAGE_GRACE_SECONDS: string;
  GUARD_SCRIPT_NAME: string;

  // always-required secrets
  CLOUDFLARE_API_TOKEN: string;
  GUARD_API_SIGNING_KEY: string;

  // per-channel secrets — arbitrary names supplied by user; looked up dynamically
  [key: string]: unknown;
};
