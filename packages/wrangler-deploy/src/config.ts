import type { CfStageConfig } from "./types.js";

/**
 * Define a wrangler-deploy configuration with full type safety and autocomplete.
 *
 * @example
 * ```ts
 * // wrangler-deploy.config.ts
 * import { defineConfig } from "wrangler-deploy/config";
 *
 * export default defineConfig({
 *   version: 1,
 *   workers: ["apps/api", "apps/batch-workflow"],
 *   deployOrder: ["apps/batch-workflow", "apps/api"],
 *   resources: {
 *     "cache-kv": {
 *       type: "kv",
 *       bindings: { "apps/api": "CACHE_KV" },
 *     },
 *   },
 * });
 * ```
 */
export function defineConfig(config: CfStageConfig): CfStageConfig {
  return config;
}
