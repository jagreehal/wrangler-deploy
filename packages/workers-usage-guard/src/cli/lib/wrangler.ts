import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAccountsJson,
  buildNotificationsJson,
  DEFAULT_DATABASE_NAME,
  type WugConfig,
} from "../config.js";

export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

export function packageWranglerJsonc(): string {
  return join(packageRoot(), "wrangler.jsonc");
}

export function packageMigrationsDir(): string {
  return join(packageRoot(), "migrations");
}

export type RunResult = { code: number; stdout: string };

export function runWranglerStreaming(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolveP, rejectP) => {
    let stdout = "";
    const child = spawn("npx", ["--no-install", "wrangler", ...args], {
      cwd,
      stdio: ["inherit", "pipe", "inherit"],
      env: process.env,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.on("error", rejectP);
    child.on("close", (code) => resolveP({ code: code ?? 1, stdout }));
  });
}

export function runWranglerCapture(args: string[], cwd: string): RunResult {
  const result = spawnSync("npx", ["--no-install", "wrangler", ...args], {
    cwd,
    encoding: "utf-8",
    env: process.env,
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, stdout: result.stdout ?? "" };
}

export type RenderedConfig = {
  path: string;
  cleanup: () => void;
};

export function renderWranglerConfig(args: { config: WugConfig; baseConfigPath: string }): RenderedConfig {
  const base = readFileSync(args.baseConfigPath, "utf-8");
  const databaseId = args.config.databaseId;
  if (!databaseId) {
    throw new Error("databaseId missing from wug.config.json. Run `wug setup` first or pass --database-id.");
  }

  const databaseName = args.config.databaseName ?? DEFAULT_DATABASE_NAME;
  const accountsJson = buildAccountsJson(args.config);
  const notificationsJson = buildNotificationsJson(args.config);
  const requestThreshold = String(args.config.vars?.requestThreshold ?? 500_000);
  const cpuTimeThresholdMs = String(args.config.vars?.cpuTimeThresholdMs ?? 5_000_000);
  const overageCooldownSeconds = String(args.config.vars?.overageCooldownSeconds ?? 3600);
  const overageGraceSeconds = String(args.config.vars?.overageGraceSeconds ?? 14_400);
  const guardScriptName = args.config.vars?.guardScriptName ?? args.config.scriptName ?? DEFAULT_DATABASE_NAME;

  let rendered = base
    .replace(/"database_id":\s*"[^"]*"/, `"database_id": "${databaseId}"`)
    .replace(/"database_name":\s*"[^"]*"/, `"database_name": "${databaseName}"`)
    .replace(/"REQUEST_THRESHOLD":\s*"[^"]*"/, `"REQUEST_THRESHOLD": "${requestThreshold}"`)
    .replace(/"CPU_TIME_THRESHOLD_MS":\s*"[^"]*"/, `"CPU_TIME_THRESHOLD_MS": "${cpuTimeThresholdMs}"`)
    .replace(/"OVERAGE_COOLDOWN_SECONDS":\s*"[^"]*"/, `"OVERAGE_COOLDOWN_SECONDS": "${overageCooldownSeconds}"`)
    .replace(/"OVERAGE_GRACE_SECONDS":\s*"[^"]*"/, `"OVERAGE_GRACE_SECONDS": "${overageGraceSeconds}"`)
    .replace(/"GUARD_SCRIPT_NAME":\s*"[^"]*"/, `"GUARD_SCRIPT_NAME": "${guardScriptName}"`)
    .replace(/"ACCOUNTS_JSON":\s*"[^"]*"/, `"ACCOUNTS_JSON": ${JSON.stringify(accountsJson)}`)
    .replace(/"NOTIFICATIONS_JSON":\s*"[^"]*"/, `"NOTIFICATIONS_JSON": ${JSON.stringify(notificationsJson)}`);

  if (args.config.scriptName && args.config.scriptName !== DEFAULT_DATABASE_NAME) {
    rendered = rendered.replace(/"name":\s*"[^"]*"/, `"name": "${args.config.scriptName}"`);
  }

  const dir = mkdtempSync(join(tmpdir(), "wug-"));
  const path = join(dir, "wrangler.jsonc");
  writeFileSync(path, rendered, "utf-8");

  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

export function ensureWranglerAvailable(cwd: string): void {
  const result = spawnSync("npx", ["--no-install", "wrangler", "--version"], { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(
      "wrangler not found. Install it: `npm install --save-dev wrangler` (or globally with `npm i -g wrangler`).",
    );
  }
}

export function packageHasMigrations(): boolean {
  return existsSync(packageMigrationsDir());
}
