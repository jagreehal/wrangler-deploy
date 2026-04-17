import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync as _execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ExecFileSyncOptions } from "node:child_process";

export type ExecFileSyncFn = (
  cmd: string,
  args: string[],
  opts: ExecFileSyncOptions & { encoding: "utf-8" }
) => string;

export type DeployGuardDeps = {
  execFileSync?: ExecFileSyncFn;
  readFileSync?: (path: string, encoding: "utf-8") => string;
  writeFileSync?: (path: string, content: string) => void;
  unlinkSync?: (path: string) => void;
};

export type DeployGuardResult = {
  workerUrl: string | undefined;
};

export function deployGuard(
  args: { guardDir: string; databaseId: string; varsOverride?: Record<string, string> },
  deps: DeployGuardDeps = {}
): DeployGuardResult {
  const {
    execFileSync = _execFileSync as unknown as ExecFileSyncFn,
    readFileSync: readFile = (p, enc) => readFileSync(p, enc),
    writeFileSync: writeFile = writeFileSync,
    unlinkSync: unlink = unlinkSync,
  } = deps;

  const templatePath = join(args.guardDir, "wrangler.jsonc");
  const tempPath = join(args.guardDir, ".wrangler-deploy-temp.jsonc");

  const template = readFile(templatePath, "utf-8");
  let patched = template.replace(
    /"database_id":\s*"REPLACE_WITH_D1_ID"/,
    `"database_id": "${args.databaseId}"`
  );
  if (args.varsOverride) {
    for (const [key, value] of Object.entries(args.varsOverride)) {
      patched = patched.replace(
        new RegExp(`"${key}":\\s*"[^"]*"`),
        `"${key}": ${JSON.stringify(value)}`
      );
    }
  }
  writeFile(tempPath, patched);

  let output: string;
  try {
    output = execFileSync("wrangler", ["deploy", "--config", ".wrangler-deploy-temp.jsonc"], {
      cwd: args.guardDir,
      encoding: "utf-8",
    });
  } finally {
    try { unlink(tempPath); } catch (_) { /* best-effort cleanup */ }
  }

  const match = output.match(/https:\/\/workers-usage-guard\.[^\s]+/);
  return { workerUrl: match?.[0] };
}
