import { execFileSync } from "node:child_process";

function wrangler(args: string[], cwd: string): string {
  try {
    return execFileSync("npx", ["wrangler", ...args], {
      encoding: "utf-8",
      cwd,
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

export function createD1Database(name: string, cwd: string): string | undefined {
  const output = wrangler(["d1", "create", name], cwd);
  const match = output.match(/([a-f0-9-]{36})/);
  return match?.[1];
}

export function deleteD1Database(name: string, cwd: string): void {
  wrangler(["d1", "delete", name, "--skip-confirmation"], cwd);
}
