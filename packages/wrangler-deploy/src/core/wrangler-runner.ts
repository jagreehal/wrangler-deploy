import { execFileSync } from "node:child_process";
import { getWranglerEnv } from "./auth.js";

export interface WranglerRunner {
  run(args: string[], cwd: string): string;
}

export function createWranglerRunner(): WranglerRunner {
  return {
    run(args: string[], cwd: string): string {
      return execFileSync("npx", ["wrangler", ...args], {
        encoding: "utf-8",
        cwd,
        env: getWranglerEnv(cwd),
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    },
  };
}
