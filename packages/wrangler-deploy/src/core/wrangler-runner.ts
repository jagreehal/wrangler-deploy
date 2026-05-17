import { execFileSync } from "node:child_process";
import { getWranglerEnv } from "./auth.js";
import { assertWranglerVersion } from "./wrangler-version-check.js";

export interface WranglerRunOptions {
  localOnly?: boolean;
  /** Skip the once-per-process peer-version check (used by the version
   *  probe itself to avoid recursion). */
  skipVersionCheck?: boolean;
}

export interface WranglerRunner {
  run(args: string[], cwd: string, options?: WranglerRunOptions): string;
}

export function createWranglerRunner(): WranglerRunner {
  return {
    run(args: string[], cwd: string, options?: WranglerRunOptions): string {
      if (!options?.skipVersionCheck) assertWranglerVersion();
      return execFileSync("npx", ["wrangler", ...args], {
        encoding: "utf-8",
        cwd,
        env: options?.localOnly ? process.env : getWranglerEnv(cwd),
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    },
  };
}
