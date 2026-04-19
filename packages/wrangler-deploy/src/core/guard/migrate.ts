import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync as _execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExecFileSyncOptions } from "node:child_process";

export type ExecFileSyncFn = (
  cmd: string,
  args: string[],
  opts: ExecFileSyncOptions & { encoding: "utf-8" }
) => string;

export type RunMigrationsDeps = {
  execFileSync?: ExecFileSyncFn;
  readFileSync?: (path: string, encoding: "utf-8") => string;
  writeFileSync?: (path: string, content: string) => void;
  unlinkSync?: (path: string) => void;
};

export type RunMigrationsResult = {
  output: string;
};

export function runMigrations(
  args: { guardDir: string; databaseId: string },
  deps: RunMigrationsDeps = {}
): RunMigrationsResult {
  const {
    execFileSync = _execFileSync as unknown as ExecFileSyncFn,
    readFileSync: readFile = (p, enc) => readFileSync(p, enc),
    writeFileSync: writeFile = writeFileSync,
    unlinkSync: unlink = unlinkSync,
  } = deps;

  const templatePath = join(args.guardDir, "wrangler.jsonc");
  const tempPath = join(args.guardDir, ".wrangler-migrate-temp.jsonc");

  const template = readFile(templatePath, "utf-8");
  const patched = template.replace(
    /"database_id":\s*"REPLACE_WITH_D1_ID"/,
    `"database_id": "${args.databaseId}"`
  );
  writeFile(tempPath, patched);

  let output: string;
  try {
    output = execFileSync(
      "wrangler",
      [
        "d1", "migrations", "apply", "workers-usage-guard",
        "--remote",
        "--config", ".wrangler-migrate-temp.jsonc",
      ],
      { cwd: args.guardDir, encoding: "utf-8" }
    );
  } finally {
    try { unlink(tempPath); } catch (_) { /* best-effort cleanup */ }
  }

  return { output };
}
