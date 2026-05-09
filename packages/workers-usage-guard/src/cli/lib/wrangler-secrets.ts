import { spawnSync } from "node:child_process";

export function putSecret(args: { name: string; value: string; cwd: string; configPath?: string }): void {
  const wranglerArgs = ["--no-install", "wrangler", "secret", "put", args.name];
  if (args.configPath) wranglerArgs.push("--config", args.configPath);
  const result = spawnSync("npx", wranglerArgs, {
    cwd: args.cwd,
    input: args.value,
    encoding: "utf-8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to set secret ${args.name}: ${result.stderr ?? result.stdout ?? "unknown error"}`);
  }
}
