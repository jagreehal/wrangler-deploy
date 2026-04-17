import { describe, expect, it } from "vitest";
import { generateGuardConfig, createD1Database, generateSigningKey } from "./init.js";

describe("generateGuardConfig", () => {

  it("generates a valid wrangler.jsonc with D1 and Workflow bindings", () => {
    const result = generateGuardConfig({
      accountId: "abc123",
      billingCycleDay: 1,
      workers: [{ scriptName: "api", thresholds: { requests: 500_000 } }],
      notifications: [],
    });
    const cfg = JSON.parse(result.wranglerJsonc);
    expect(cfg.name).toBe("workers-usage-guard");
    expect(cfg.d1_databases).toHaveLength(1);
    expect(cfg.d1_databases[0].database_id).toBe("REPLACE_WITH_D1_ID");
    expect(cfg.workflows).toHaveLength(1);
  });

  it("includes notification channels in NOTIFICATIONS_JSON", () => {
    const result = generateGuardConfig({
      accountId: "abc123",
      billingCycleDay: 1,
      workers: [],
      notifications: [
        { type: "discord", name: "prod", webhookUrlSecret: "DISCORD_PROD_WEBHOOK" },
      ],
    });
    const cfg = JSON.parse(result.wranglerJsonc);
    const notif = JSON.parse(cfg.vars.NOTIFICATIONS_JSON);
    expect(notif.channels).toHaveLength(1);
    expect(notif.channels[0].type).toBe("discord");
  });

  it("returns a secrets checklist with required secrets", () => {
    const result = generateGuardConfig({
      accountId: "abc123",
      billingCycleDay: 1,
      workers: [],
      notifications: [
        { type: "discord", name: "prod", webhookUrlSecret: "DISCORD_WEBHOOK" },
        { type: "slack", name: "eng", webhookUrlSecret: "SLACK_WEBHOOK" },
      ],
    });
    expect(result.secretsChecklist).toContain("CLOUDFLARE_API_TOKEN");
    expect(result.secretsChecklist).toContain("GUARD_API_SIGNING_KEY");
    expect(result.secretsChecklist).toContain("DISCORD_WEBHOOK");
    expect(result.secretsChecklist).toContain("SLACK_WEBHOOK");
  });

  it("returns a post-init checklist with next steps", () => {
    const result = generateGuardConfig({
      accountId: "abc123",
      billingCycleDay: 1,
      workers: [],
      notifications: [],
    });
    expect(result.nextSteps.length).toBeGreaterThan(0);
    expect(result.nextSteps.some((s) => s.includes("wrangler d1"))).toBe(true);
    expect(result.nextSteps.some((s) => s.includes("wrangler secret"))).toBe(true);
    expect(result.nextSteps.some((s) => s.includes("wrangler deploy"))).toBe(true);
  });

  it("includes webhook urlSecret in secrets checklist", () => {
    const result = generateGuardConfig({
      accountId: "abc123",
      billingCycleDay: 1,
      workers: [],
      notifications: [
        { type: "webhook", name: "ops", urlSecret: "OPS_WEBHOOK_URL" },
      ],
    });
    expect(result.secretsChecklist).toContain("OPS_WEBHOOK_URL");
  });

  it("parses ACCOUNTS_JSON correctly", () => {
    const result = generateGuardConfig({
      accountId: "abc123",
      billingCycleDay: 15,
      workers: [{ scriptName: "api" }],
      notifications: [],
    });
    const cfg = JSON.parse(result.wranglerJsonc);
    const accounts = JSON.parse(cfg.vars.ACCOUNTS_JSON);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountId).toBe("abc123");
    expect(accounts[0].billingCycleDay).toBe(15);
    expect(accounts[0].workers).toHaveLength(1);
    expect(accounts[0].workers[0].scriptName).toBe("api");
  });
});

describe("createD1Database", () => {
  it("parses database_id from wrangler 4.x text output", () => {
    const wranglerOutput = `✅ Successfully created DB 'workers-usage-guard' in region WEUR\n{\n  "d1_databases": [{"binding": "DB", "database_name": "workers-usage-guard", "database_id": "ae724c8a-4cb3-4aa0-934c-2b80f0097f53"}]\n}\n`;
    const result = createD1Database(
      { name: "workers-usage-guard", targetDir: "/tmp" },
      {
        execFileSync: (() => wranglerOutput) as unknown as typeof import("node:child_process").execFileSync,
      }
    );
    expect(result.databaseId).toBe("ae724c8a-4cb3-4aa0-934c-2b80f0097f53");
  });

  it("throws when output does not include database_id", () => {
    expect(() =>
      createD1Database(
        { name: "workers-usage-guard", targetDir: "/tmp" },
        {
          execFileSync: (() => "some unrelated output") as unknown as typeof import("node:child_process").execFileSync,
        }
      )
    ).toThrow(/Could not parse D1 database id/);
  });
});

describe("generateSigningKey", () => {
  it("returns a 64-character hex string", () => {
    const key = generateSigningKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it("returns a different value on each call", () => {
    expect(generateSigningKey()).not.toBe(generateSigningKey());
  });
});
