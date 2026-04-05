import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { WranglerConfig } from "../types.js";

/**
 * Read and parse a wrangler.jsonc file, stripping comments.
 */
export function readWranglerConfig(workerDir: string): WranglerConfig {
  const jsonPath = join(workerDir, "wrangler.jsonc");
  const jsonPathAlt = join(workerDir, "wrangler.json");
  const tomlPath = join(workerDir, "wrangler.toml");

  let filePath: string;
  if (existsSync(jsonPath)) {
    filePath = jsonPath;
  } else if (existsSync(jsonPathAlt)) {
    filePath = jsonPathAlt;
  } else if (existsSync(tomlPath)) {
    throw new Error(
      `wrangler-deploy does not support wrangler.toml. Convert to wrangler.jsonc: ${tomlPath}`,
    );
  } else {
    throw new Error(`No wrangler config found in ${workerDir}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  // Strip JSONC comments while preserving strings that contain //
  // Strategy: match strings first (to skip them), then match comments
  const stripped = raw.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) => {
    // If it starts with a quote, it's a string — keep it
    if (match.startsWith('"')) return match;
    // Otherwise it's a comment — remove it
    return "";
  });

  try {
    return JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`, { cause: err });
  }
}

/**
 * Discover all worker directories in the monorepo that have wrangler configs.
 */
export function discoverWorkers(
  rootDir: string,
  workerPaths: string[],
): Map<string, WranglerConfig> {
  const workers = new Map<string, WranglerConfig>();

  for (const workerPath of workerPaths) {
    const fullPath = join(rootDir, workerPath);
    const config = readWranglerConfig(fullPath);
    workers.set(workerPath, config);
  }

  return workers;
}
