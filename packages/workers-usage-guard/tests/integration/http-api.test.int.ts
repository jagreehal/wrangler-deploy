// tests/integration/http-api.test.int.ts
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
// 5. `mf.dispatchFetch()` IS supported in Miniflare v4 and is used here to test
//    the HTTP fetch handler directly without needing a real HTTP server.
//
// Tests 3 scenarios:
//   1. GET /api/health returns 200 without any signature (public endpoint).
//   2. GET /api/breaches returns 401 for unsigned requests.
//   3. GET /api/breaches returns 200 for correctly signed requests.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signRequest } from "../../src/http/signing.js";

const PKG_ROOT = resolve(__dirname, "../..");

let mf: Miniflare;
const SIGNING_KEY = "int-key";

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
      ACCOUNTS_JSON: JSON.stringify([]),
      NOTIFICATIONS_JSON: JSON.stringify({ channels: [] }),
      REQUEST_THRESHOLD: "1",
      CPU_TIME_THRESHOLD_MS: "1",
      OVERAGE_COOLDOWN_SECONDS: "3600",
      OVERAGE_GRACE_SECONDS: "14400",
      GUARD_SCRIPT_NAME: "workers-usage-guard",
      // Fake Cloudflare token — GraphQL calls will fail, which is expected.
      CLOUDFLARE_API_TOKEN: "fake",
      // GUARD_API_SIGNING_KEY must match what signRequest() uses so that the
      // Worker can verify the HMAC we produce in the signed test case.
      GUARD_API_SIGNING_KEY: SIGNING_KEY,
    },
  });

  // Apply the D1 schema
  const db = await mf.getD1Database("DB");
  for (const stmt of migrationStatements) {
    await db.prepare(stmt).run();
  }
}, 30_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("HTTP API", () => {
  it("GET /api/health returns ok without a signature", async () => {
    const res = await mf.dispatchFetch("https://guard.example.com/api/health");
    expect(res.status).toBe(200);
  });

  it("GET /api/breaches rejects unsigned requests with 401", async () => {
    const res = await mf.dispatchFetch(
      "https://guard.example.com/api/breaches?account=a"
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/breaches accepts a correctly signed request", async () => {
    const ts = new Date().toISOString();
    const path = "/api/breaches?account=a";
    const sig = await signRequest({
      method: "GET",
      path,
      timestamp: ts,
      key: SIGNING_KEY,
    });
    const res = await mf.dispatchFetch("https://guard.example.com" + path, {
      headers: {
        "x-guard-timestamp": ts,
        "x-guard-signature": sig,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { breaches: unknown[] };
    expect(Array.isArray(body.breaches)).toBe(true);
  });
});
