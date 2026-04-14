import type { CfStageConfig } from "../types.js";
import type { StateProvider } from "./state.js";
import { stageMatchesPattern } from "./naming.js";
import { destroy } from "./destroy.js";
import type { WranglerRunner } from "./wrangler-runner.js";

/**
 * Parse a TTL string like "7d", "24h", "30m" to milliseconds.
 */
function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid TTL format: "${ttl}". Use "7d", "24h", or "30m".`);
  const value = parseInt(match[1] ?? "0");
  switch (match[2]) {
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "m":
      return value * 60 * 1000;
    default:
      throw new Error(`Invalid TTL unit: ${match[2]}`);
  }
}

export interface GcResult {
  destroyed: string[];
  kept: string[];
  protected: string[];
}

export type GcArgs = Record<string, never>;

export type GcDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
  logger?: Pick<Console, "log" | "warn" | "error">;
  destroyFn?: typeof destroy;
};

/**
 * Garbage collect expired stages.
 * Only destroys stages matching an unprotected pattern with an expired TTL.
 */
export async function gc(_args: GcArgs, deps: GcDeps): Promise<GcResult> {
  const { rootDir, config, state: provider, wrangler, logger = console } = deps;
  const destroyFn = deps.destroyFn ?? destroy;
  const stages = await provider.list();
  const result: GcResult = { destroyed: [], kept: [], protected: [] };
  const now = Date.now();

  for (const stageName of stages) {
    const state = await provider.read(stageName);
    if (!state) continue;

    // Find matching stage rule
    let matched = false;
    for (const [pattern, rule] of Object.entries(config.stages ?? {})) {
      if (stageMatchesPattern(stageName, pattern)) {
        matched = true;

        if (rule.protected) {
          result.protected.push(stageName);
          break;
        }

        if (!rule.ttl) {
          result.kept.push(stageName);
          break;
        }

        const ttlMs = parseTtl(rule.ttl);
        const createdAt = new Date(state.createdAt).getTime();
        const expired = now - createdAt > ttlMs;

        if (expired) {
          result.destroyed.push(stageName);
          await destroyFn(
            { stage: stageName, force: false },
            { rootDir, config, state: provider, wrangler, logger },
          );
        } else {
          result.kept.push(stageName);
        }
        break;
      }
    }

    // No matching pattern — treated as protected (safe default)
    if (!matched) {
      result.protected.push(stageName);
    }
  }

  return result;
}
