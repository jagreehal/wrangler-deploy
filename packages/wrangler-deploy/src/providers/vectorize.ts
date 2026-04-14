import { execFileSync } from "node:child_process";
import { getWranglerEnv } from "../core/auth.js";
import type { VectorizeOutput } from "../types.js";

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

export interface VectorizeConfig {
  dimensions?: number;
  metric?: "euclidean" | "cosine" | "dot-product";
  preset?: string;
  description?: string;
}

export function createVectorizeIndex(
  name: string,
  config: VectorizeConfig,
  cwd: string,
): VectorizeOutput {
  const args = ["vectorize", "create", name];

  if (config.preset) {
    args.push("--preset", config.preset);
  } else {
    if (config.dimensions) args.push("--dimensions", String(config.dimensions));
    if (config.metric) args.push("--metric", config.metric);
  }
  if (config.description) args.push("--description", config.description);

  const output = wrangler(args, cwd);
  const match = output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return { id: match?.[1], name, dimensions: config.dimensions, metric: config.metric };
}

export function deleteVectorizeIndex(name: string, cwd: string): void {
  wrangler(["vectorize", "delete", name, "--force"], cwd);
}
