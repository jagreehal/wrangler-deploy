import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWranglerConfig } from "./wrangler.js";

const SAMPLE = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "workers-usage-guard",
  "main": "dist/index.js",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "workers-usage-guard",
      "database_id": "REPLACE_WITH_D1_ID",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "REQUEST_THRESHOLD": "500000",
    "CPU_TIME_THRESHOLD_MS": "5000000",
    "OVERAGE_COOLDOWN_SECONDS": "3600",
    "OVERAGE_GRACE_SECONDS": "14400",
    "GUARD_SCRIPT_NAME": "workers-usage-guard",
    "ACCOUNTS_JSON": "[]",
    "NOTIFICATIONS_JSON": "{\\"channels\\":[]}"
  }
}
`;

describe("renderWranglerConfig", () => {
  it("substitutes database_id and accounts/notifications from wug config", () => {
    const dir = mkdtempSync(join(tmpdir(), "wug-render-"));
    const base = join(dir, "wrangler.jsonc");
    writeFileSync(base, SAMPLE);
    try {
      const rendered = renderWranglerConfig({
        config: {
          databaseId: "abc-123",
          accounts: [
            {
              accountId: "acct-a",
              billingCycleDay: 1,
              workers: [{ scriptName: "api", thresholds: { requests: 100 } }],
              globalProtected: [],
            },
          ],
          notifications: { channels: [{ type: "discord", webhookUrlSecret: "DISCORD_HOOK" }] },
          vars: { requestThreshold: 999_999 },
        },
        baseConfigPath: base,
      });
      try {
        const out = readFileSync(rendered.path, "utf-8");
        expect(out).toContain('"database_id": "abc-123"');
        expect(out).toContain('"REQUEST_THRESHOLD": "999999"');
        expect(out).toContain("acct-a");
        expect(out).toContain("DISCORD_HOOK");
        expect(out).not.toContain("REPLACE_WITH_D1_ID");
      } finally {
        rendered.cleanup();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when databaseId missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "wug-render-"));
    const base = join(dir, "wrangler.jsonc");
    writeFileSync(base, SAMPLE);
    try {
      expect(() =>
        renderWranglerConfig({
          config: { accounts: [] },
          baseConfigPath: base,
        }),
      ).toThrow(/databaseId/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
