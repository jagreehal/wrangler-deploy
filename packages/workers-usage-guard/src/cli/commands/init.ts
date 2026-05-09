import type { ParsedArgs } from "../parse.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { saveConfig, type WugConfig, DEFAULT_CONFIG_FILE } from "../config.js";
import { boolFlag, requireString } from "../parse.js";

export const summary = "Write a starter wug.config.json (no D1 / no deploy)";

export const help = `
wug init --account <id> [--script-name <name>] [--billing-cycle-day <1-31>] [--force]

Writes a minimal wug.config.json to the current directory. Run \`wug setup\`
afterwards to provision D1, set secrets, and deploy.

For a full one-shot install, prefer \`wug setup\` instead.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const path = resolve(cwd, DEFAULT_CONFIG_FILE);
  const force = boolFlag(args.flags, "force");
  if (existsSync(path) && !force) {
    throw new Error(`${DEFAULT_CONFIG_FILE} already exists. Pass --force to overwrite.`);
  }

  const accountId = requireString(args.flags, "account", "--account is required (your Cloudflare account ID)");
  const billingCycleDay = Number(args.flags["billing-cycle-day"] ?? 1);
  const scriptName = typeof args.flags["script-name"] === "string" ? args.flags["script-name"] : "workers-usage-guard";

  const config: WugConfig = {
    scriptName,
    accounts: [
      {
        accountId,
        billingCycleDay,
        workers: [],
        globalProtected: [],
      },
    ],
    notifications: { channels: [] },
    vars: {
      requestThreshold: 500_000,
      cpuTimeThresholdMs: 5_000_000,
      overageCooldownSeconds: 3600,
      overageGraceSeconds: 14_400,
    },
  };

  const written = saveConfig({ cwd, config });
  console.log(JSON.stringify({ ok: true, file: written }, null, 2));
  return 0;
}
