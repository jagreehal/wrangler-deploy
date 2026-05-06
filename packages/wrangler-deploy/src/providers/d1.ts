import { execFileSync } from "node:child_process";
import { getWranglerEnv } from "../core/auth.js";
import type { D1Output } from "../types.js";

function wrangler(args: string[], cwd: string): string {
  try {
    return execFileSync("npx", ["wrangler", ...args], {
      encoding: "utf-8",
      cwd,
      env: getWranglerEnv(cwd),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string; stdout?: string };
    const output = (error.stderr || "") + (error.stdout || "");
    if (output.includes("already exists")) {
      return output;
    }
    throw new Error(`wrangler ${args.join(" ")} failed: ${output}`, { cause: err });
  }
}

export function createD1Database(name: string, cwd: string): D1Output {
  const output = wrangler(["d1", "create", name], cwd);
  const match = output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return { id: match?.[1], name, version: "v1" };
}

export function deleteD1Database(name: string, cwd: string): void {
  wrangler(["d1", "delete", name, "--skip-confirmation"], cwd);
}

export interface D1MigrationOptions {
  /** Database staged name. */
  name: string;
  /** Path to the migrations directory (resolved by caller relative to cwd). */
  migrationsDir: string;
  /** Tracker table name. Defaults to wrangler's d1_migrations. */
  migrationsTable?: string;
  /** Whether to apply against the remote DB (true) or local (false). */
  remote: boolean;
  /** Working directory for the wrangler invocation. */
  cwd: string;
}

/**
 * Apply pending D1 migrations. Wraps `wrangler d1 migrations apply`. The
 * --remote flag controls whether wrangler hits the live database or the
 * local miniflare-managed sqlite.
 */
export function applyD1Migrations(options: D1MigrationOptions): string {
  const args = [
    "d1",
    "migrations",
    "apply",
    options.name,
    options.remote ? "--remote" : "--local",
    "--y",
  ];
  if (options.migrationsTable && options.migrationsTable !== "d1_migrations") {
    args.push("--migrations-table", options.migrationsTable);
  }
  // wrangler d1 migrations apply reads from the cwd's `migrations/` folder
  // by default; the override is `--migrations-table` and `--migrations-folder`.
  args.push("--migrations-folder", options.migrationsDir);
  return wrangler(args, options.cwd);
}

export interface D1ImportOptions {
  name: string;
  file: string;
  remote: boolean;
  cwd: string;
}

/**
 * Run a one-shot SQL file against a D1 database. Wraps
 * `wrangler d1 execute --file`. Used for `importFiles` on first apply.
 */
export function executeD1File(options: D1ImportOptions): string {
  const args = [
    "d1",
    "execute",
    options.name,
    options.remote ? "--remote" : "--local",
    "--file",
    options.file,
    "--y",
  ];
  return wrangler(args, options.cwd);
}
