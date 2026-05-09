import { randomBytes } from "node:crypto";
import { runWranglerCapture } from "./wrangler.js";

export function generateSigningKey(): string {
  return randomBytes(32).toString("hex");
}

export function createD1Database(args: { name: string; cwd: string }): { databaseId: string } {
  const result = runWranglerCapture(["d1", "create", args.name], args.cwd);
  if (result.code !== 0) {
    throw new Error(`wrangler d1 create failed: ${result.stdout}`);
  }
  const match = result.stdout.match(/"database_id":\s*"([^"]+)"/);
  if (!match?.[1]) throw new Error(`could not parse database_id from wrangler output:\n${result.stdout}`);
  return { databaseId: match[1] };
}

export function parseDeployedEndpoint(stdout: string): string | null {
  const match = stdout.match(/https:\/\/[a-zA-Z0-9-]+\.workers\.dev/);
  return match?.[0] ?? null;
}
