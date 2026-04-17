// tests/integration/workflow.test.int.ts
//
// Miniflare v4 API notes (same constraints as scheduled.test.int.ts):
//
// 1. Miniflare v4 does not transpile TypeScript — use the pre-built bundle at
//    dist-bundle/index.js (produced by `wrangler deploy --dry-run --outdir dist-bundle`).
//
// 2. `compatibilityDate` is capped at "2026-04-08" by the embedded workerd binary.
//
// 3. `workflows` binding is a Record<bindingName, descriptor>, not an array.
//
// 4. `db.exec()` fails on comment-only leading lines — strip comments and execute
//    each statement individually via `db.prepare(stmt).run()`.
//
// This test asserts: for any breach_forensics row with a completed workflow,
// actions_taken_json is non-null.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PKG_ROOT = resolve(__dirname, "../..");

let mf: Miniflare;

beforeAll(async () => {
  // The integration test requires a pre-built Worker bundle produced by:
  //   wrangler deploy --dry-run --outdir dist-bundle
  // Run this command (or `pnpm build:bundle`) before executing the test.
  const bundlePath = resolve(PKG_ROOT, "dist-bundle/index.js");
  if (!existsSync(bundlePath)) {
    throw new Error(
      `Worker bundle not found at ${bundlePath}.\n` +
        "Run: cd packages/workers-usage-guard && wrangler deploy --dry-run --outdir dist-bundle"
    );
  }
  const script = readFileSync(bundlePath, "utf8");

  // Strip SQL comments so that the D1 mock's prepare() parser doesn't choke on
  // comment-only leading lines, then split into individual statements.
  const rawMigration = readFileSync(resolve(PKG_ROOT, "migrations/0001_init.sql"), "utf8");
  const migrationStatements = rawMigration
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  mf = new Miniflare({
    modules: true,
    script,
    // Must not exceed the max compat date supported by the embedded workerd
    // binary bundled with this miniflare version (2026-04-08 as of v4.20260401.0).
    compatibilityDate: "2026-04-08",
    compatibilityFlags: ["nodejs_compat"],
    // Bind D1 by name
    d1Databases: ["DB"],
    // Workflows binding: Record<bindingName, descriptor> (not an array in v4)
    workflows: {
      OVERAGE_WORKFLOW: {
        name: "overage-workflow",
        className: "OverageWorkflow",
      },
    },
    bindings: {
      ACCOUNTS_JSON: JSON.stringify([
        {
          accountId: "a",
          billingCycleDay: 1,
          workers: [{ scriptName: "api", thresholds: { requests: 1 }, zones: [] }],
          globalProtected: [],
        },
      ]),
      NOTIFICATIONS_JSON: JSON.stringify({ channels: [] }),
      REQUEST_THRESHOLD: "1",
      CPU_TIME_THRESHOLD_MS: "1",
      OVERAGE_COOLDOWN_SECONDS: "3600",
      OVERAGE_GRACE_SECONDS: "14400",
      GUARD_SCRIPT_NAME: "workers-usage-guard",
      // Fake credentials — GraphQL calls will fail, which is expected.
      CLOUDFLARE_API_TOKEN: "fake",
      GUARD_API_SIGNING_KEY: "fake",
    },
  });

  // Apply the D1 schema
  const db = await mf.getD1Database("DB");
  for (const stmt of migrationStatements) {
    await db.prepare(stmt).run();
  }

  // Seed a completed breach_forensics row (actions_taken_json populated,
  // simulating a Workflow that ran to completion).
  await db
    .prepare(
      `INSERT INTO breach_forensics (id, breach_key, workflow_instance_id, triggered_at, rule_id, graphql_response_json, actions_taken_json)
       VALUES ('f-1', 'a:api:requests', 'wf-1', '2026-04-17T12:00:00Z', 'request-flood', '{}', '{"removedRoutes":[],"removedDomains":[]}')`
    )
    .run();
}, 30_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("forensics property", () => {
  it("any completed breach has non-null actions_taken_json", async () => {
    const db = await mf.getD1Database("DB");
    const { results } = await db
      .prepare("SELECT id, actions_taken_json FROM breach_forensics")
      .all<{ id: string; actions_taken_json: string | null }>();

    // There must be at least one row for this assertion to be meaningful.
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.actions_taken_json).not.toBeNull();
    }
  });
});
