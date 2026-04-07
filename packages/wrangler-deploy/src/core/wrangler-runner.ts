import { execFileSync } from "node:child_process";
import { getWranglerEnv } from "./auth.js";

export interface WranglerRunOptions {
  localOnly?: boolean;
}

export interface WranglerRunner {
  run(args: string[], cwd: string, options?: WranglerRunOptions): string;
}

export function createWranglerRunner(): WranglerRunner {
  return {
    run(args: string[], cwd: string, options?: WranglerRunOptions): string {
      return execFileSync("npx", ["wrangler", ...args], {
        encoding: "utf-8",
        cwd,
        env: options?.localOnly ? process.env : getWranglerEnv(cwd),
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    },
  };
}
