import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./safe-mode.js";

const originalCwd = process.cwd();
const originalEnv = { ...process.env };

afterEach(() => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function writeConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "wug-safe-mode-"));
  writeFileSync(
    join(dir, "wug.config.json"),
    JSON.stringify(
      {
        accounts: [
          {
            accountId: "acc-1",
            billingCycleDay: 1,
            globalProtected: [],
            workers: [{ scriptName: "api", thresholds: { requests: 500 } }],
          },
        ],
        notifications: {
          channels: [{ type: "discord", webhookUrlSecret: "DISCORD_WEBHOOK" }],
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
  return dir;
}

describe("safe-mode command", () => {
  it("fails when required secrets are missing", async () => {
    const dir = writeConfig();
    process.chdir(dir);
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.GUARD_API_SIGNING_KEY;
    delete process.env.DISCORD_WEBHOOK;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await run({ command: "safe-mode", positional: [], flags: { json: true } });
    expect(code).toBe(1);
  });

  it("passes when required secrets are present", async () => {
    const dir = writeConfig();
    process.chdir(dir);
    process.env.CLOUDFLARE_API_TOKEN = "x";
    process.env.GUARD_API_SIGNING_KEY = "y";
    process.env.DISCORD_WEBHOOK = "z";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = await run({ command: "safe-mode", positional: [], flags: { json: true } });
    expect(code).toBe(0);
  });
});

