import { execFileSync } from "node:child_process";
import { getWranglerEnv } from "../core/auth.js";
import type { R2Output } from "../types.js";

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

export function createR2Bucket(name: string, cwd: string): R2Output {
  wrangler(["r2", "bucket", "create", name], cwd);
  return { name };
}

export function deleteR2Bucket(name: string, cwd: string): void {
  wrangler(["r2", "bucket", "delete", name], cwd);
}
