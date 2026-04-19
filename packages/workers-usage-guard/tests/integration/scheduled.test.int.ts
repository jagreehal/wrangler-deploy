// tests/integration/scheduled.test.int.ts
//
// Miniflare v4 API notes (v4.20260401.0 differs from the plan's assumptions):
//
// 1. `dispatchScheduled()` does not exist in v4. Instead, set `unsafeTriggerHandlers: true`
//    and `host`/`port` on the Miniflare instance, then fetch
//    `GET /cdn-cgi/handler/scheduled?cron=<pattern>` against the dev server URL.
//
// 2. `workflows` binding is a plain object (Record<bindingName, {...}>), not an array.
//
// 3. The bundled worker script must be produced ahead-of-time by wrangler
//    (`wrangler deploy --dry-run --outdir dist-bundle`). Miniflare v4 does not
//    transpile TypeScript on its own.
//
// 4. `compatibilityDate` is capped at "2026-04-08" by this version of the embedded
//    workerd binary. Using "2026-04-17" causes the runtime to refuse to start.
//
// 5. `db.exec()` fails when the SQL file starts with a comment-only line. Strip
//    comments and execute each statement individually via `db.prepare(stmt).run()`.
//
// This test asserts plumbing, not a happy-path run against real Cloudflare.
// A real-token smoke test lives in apps/smoke-test/ in Phase 2.

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { Miniflare } from "miniflare";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const PKG_ROOT = resolve(__dirname, "../..");

let mf: Miniflare;
let devUrl: URL;

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

  // Strip SQL comments so that the D1 mock's exec() parser doesn't choke on
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
    // Workflows binding: record<bindingName, descriptor> (not an array in v4)
    workflows: {
      OVERAGE_WORKFLOW: {
        name: "overage-workflow",
        className: "OverageWorkflow",
      },
    },
    // Enable GET /cdn-cgi/handler/scheduled?cron=… triggering
    unsafeTriggerHandlers: true,
    // Expose an HTTP port so we can reach the /cdn-cgi/handler/* endpoints
    host: "127.0.0.1",
    port: 0,
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

  // Wait for the dev server to be ready and capture its URL
  devUrl = await mf.ready;

  // Apply the D1 schema
  const db = await mf.getD1Database("DB");
  for (const stmt of migrationStatements) {
    await db.prepare(stmt).run();
  }
}, 30_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("scheduled handler — every 5 min", () => {
  it("invokes without fatal errors and D1 is reachable", async () => {
    // Trigger the scheduled handler via the Miniflare /cdn-cgi/handler/scheduled
    // endpoint. The handler will attempt to call the Cloudflare GraphQL API with
    // a fake token, so it may return HTTP 500 — that is expected. What matters is
    // that the Worker runtime did not crash and the D1 binding is functional.
    let status: number | undefined;
    try {
      const resp = await fetch(
        new URL(
          // URL-encode the cron expression so the query param parses correctly
          "/cdn-cgi/handler/scheduled?cron=" + encodeURIComponent("*/5 * * * *"),
          devUrl
        )
      );
      status = resp.status;
    } catch {
      // A fetch-level error (connection refused, etc.) means Miniflare crashed —
      // re-throw so the test fails with a meaningful message.
      throw new Error("Miniflare fetch threw — runtime may have crashed");
    }

    // 200 = clean run, 500 = handler threw (expected with fake token).
    // Anything else (e.g., 404 from wrong routing) is a wiring bug.
    expect([200, 500]).toContain(status);

    // Give ctx.waitUntil() tasks a moment to settle
    await new Promise((r) => setTimeout(r, 1_500));

    // Assert the D1 binding is reachable and the schema was applied correctly.
    // The scheduled handler may write to activity_log on success; with a fake
    // token it typically writes nothing — we only assert the type is numeric.
    const db = await mf.getD1Database("DB");
    const row = await db
      .prepare("SELECT count(*) as c FROM activity_log")
      .first<{ c: number }>();

    expect(typeof row?.c).toBe("number");
  });
});
