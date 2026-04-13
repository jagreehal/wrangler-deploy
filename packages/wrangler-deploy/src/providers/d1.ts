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
