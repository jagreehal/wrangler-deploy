import { spawnSync } from "node:child_process";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

/**
 * Pick the package manager the user is invoking us with, falling back to
 * the first available on PATH. We prefer the npm_config_user_agent signal
 * because it tells us exactly what the user typed (e.g. `npm create ...`
 * sets it to `npm/x.y.z ...`, `pnpm create ...` to `pnpm/x.y.z ...`).
 */
export function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("npm/")) return "npm";

  for (const candidate of ["pnpm", "bun", "yarn", "npm"] as const) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  return "npm";
}

export function runCommand(pm: PackageManager): string {
  return pm === "npm" ? "npm run" : pm;
}

export interface InstallResult {
  ok: boolean;
  pm: PackageManager;
  exitCode: number | null;
}

/**
 * Run `<pm> install` in the scaffolded directory. Streams to the terminal
 * so the user sees progress on big installs. Best-effort: if it fails we
 * surface the exit code instead of throwing so the caller can fall back to
 * printing manual next steps.
 */
export function runInstall(targetDir: string, pm: PackageManager): InstallResult {
  const result = spawnSync(pm, ["install"], {
    cwd: targetDir,
    stdio: "inherit",
    env: process.env,
  });
  return {
    ok: result.status === 0,
    pm,
    exitCode: result.status,
  };
}
