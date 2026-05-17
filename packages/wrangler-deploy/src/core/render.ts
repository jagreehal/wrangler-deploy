import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { CfStageConfig, StageState, WranglerConfig, QueueBinding } from "../types.js";
import { resourceId, resourceStagedName } from "../types.js";
import { resolveAccountId } from "./auth.js";
import { resourceName, workerName } from "./naming.js";

/**
 * Generate a rendered wrangler config for a worker at a given stage.
 * This is a complete, self-contained config that can be passed to
 * `wrangler deploy -c <path>`.
 *
 * When `rootDir` is set:
 * - `main` is resolved to an absolute path from the repo root.
 * - `account_id` is set via `resolveAccountId` for the worker directory (`rootDir` +
 *   `workerPath`), matching the account injected by `getWranglerEnv` so deploys do not
 *   hit Cloudflare API error 10000 from mixing an API token with a different account than the
 *   rendered file implies.
 * If resolution throws, `account_id` falls back to a non-empty `baseConfig.account_id` when
 * present. When `rootDir` is omitted, or resolution fails and the base config has no
 * `account_id`, the rendered object has no `account_id` field (unless copied from `baseConfig`).
 */
export function renderWranglerConfig(
  baseConfig: WranglerConfig,
  workerPath: string,
  config: CfStageConfig,
  state: StageState,
  stage: string,
  rootDir?: string,
): WranglerConfig {
  const rendered: WranglerConfig = { ...baseConfig };

  // Stage-suffix the worker name
  rendered.name = workerName(baseConfig.name, stage);

  // Make path-bearing fields absolute relative to the SOURCE worker directory
  // (where the user-authored wrangler.jsonc lives). The rendered file is
  // written elsewhere (.wrangler-deploy/<stage>/<workerPath>/wrangler.rendered.jsonc),
  // so relative paths like `../../drizzle` or `src/index.ts` would otherwise
  // resolve from the wrong base when wrangler reads the rendered config.
  if (rootDir) {
    const sourceDir = resolve(rootDir, workerPath);

    // `main` — worker entry script
    if (typeof rendered.main === "string" && rendered.main.trim()) {
      rendered.main = resolve(sourceDir, rendered.main);
    }

    // `migrations_dir` — D1 migrations folder (wrangler resolves relative to
    // the config file's directory; rendered file lives in a different dir).
    if (typeof rendered["migrations_dir"] === "string" && (rendered["migrations_dir"] as string).trim()) {
      rendered["migrations_dir"] = resolve(sourceDir, rendered["migrations_dir"] as string);
    }

    // `assets.directory` — static asset bundle path
    const assets = rendered["assets"];
    if (assets && typeof assets === "object" && !Array.isArray(assets)) {
      const assetsObj = assets as Record<string, unknown>;
      if (typeof assetsObj["directory"] === "string" && (assetsObj["directory"] as string).trim()) {
        rendered["assets"] = {
          ...assetsObj,
          directory: resolve(sourceDir, assetsObj["directory"] as string),
        };
      }
    }

    // `site.bucket` — legacy Workers Sites bucket path
    const site = rendered["site"];
    if (site && typeof site === "object" && !Array.isArray(site)) {
      const siteObj = site as Record<string, unknown>;
      if (typeof siteObj["bucket"] === "string" && (siteObj["bucket"] as string).trim()) {
        rendered["site"] = {
          ...siteObj,
          bucket: resolve(sourceDir, siteObj["bucket"] as string),
        };
      }
    }
  }

  // Remove localConnectionString and filter out placeholder Hyperdrive IDs
  if (rendered.hyperdrive) {
    rendered.hyperdrive = rendered.hyperdrive
      .map((h) => {
        const { localConnectionString: _localConnectionString, ...rest } = h;
        return rest;
      })
      .filter((h) => h.id && !h.id.includes("placeholder"));
    if (rendered.hyperdrive.length === 0) {
      delete rendered.hyperdrive;
    }
  }

  // Replace resource IDs from state
  for (const [logicalName, resource] of Object.entries(config.resources)) {
    const stateResource = state.resources[logicalName];
    if (!stateResource) continue;

    const rid = resourceId(stateResource);
    if (!rid && resource.type !== "queue" && resource.type !== "r2") continue;

    const bindings = resource.bindings;
    const binding = bindings[workerPath];
    if (!binding) continue;

    switch (resource.type) {
      case "d1": {
        if (!rid) break;
        const bindingName = binding as string;
        const databaseName = resourceStagedName(stateResource);
        rendered.d1_databases = rendered.d1_databases?.map((db) =>
          db.binding === bindingName ? { ...db, database_id: rid, database_name: databaseName } : db,
        ) ?? [{ binding: bindingName, database_id: rid, database_name: databaseName }];
        break;
      }

      case "kv": {
        if (!rid) break;
        const bindingName = binding as string;
        rendered.kv_namespaces = rendered.kv_namespaces?.map((kv) =>
          kv.binding === bindingName ? { ...kv, id: rid } : kv,
        ) ?? [{ binding: bindingName, id: rid }];
        break;
      }

      case "hyperdrive": {
        if (!rid) break;
        const bindingName = binding as string;
        rendered.hyperdrive = rendered.hyperdrive?.map((h) =>
          h.binding === bindingName ? { ...h, id: rid } : h,
        ) ?? [{ binding: bindingName, id: rid }];
        break;
      }

      case "r2": {
        const bindingName = binding as string;
        const bucketName = resourceStagedName(stateResource);
        rendered.r2_buckets = rendered.r2_buckets?.map((bucket) =>
          bucket.binding === bindingName ? { ...bucket, bucket_name: bucketName } : bucket,
        ) ?? [{ binding: bindingName, bucket_name: bucketName }];
        break;
      }

      case "queue": {
        const queueBinding = binding as QueueBinding;
        // Use the authoritative name from state, not a computed name
        const stagedName = resourceStagedName(stateResource);

        if (typeof queueBinding === "string" || "producer" in (queueBinding as object)) {
          const producerBinding =
            typeof queueBinding === "string"
              ? queueBinding
              : (queueBinding as { producer: string }).producer;

          rendered.queues = rendered.queues ?? {};
          rendered.queues.producers = rendered.queues.producers?.map((p) =>
            p.binding === producerBinding ? { ...p, queue: stagedName } : p,
          ) ?? [{ queue: stagedName, binding: producerBinding }];
        }

        if (typeof queueBinding === "object" && "consumer" in queueBinding) {
          rendered.queues = rendered.queues ?? {};
          // Only rewrite the consumer entry for this specific queue
          rendered.queues.consumers = rendered.queues.consumers?.map((c) =>
            c.queue === logicalName ? { ...c, queue: stagedName } : c,
          );
        }

        if (typeof queueBinding === "object" && "deadLetterFor" in queueBinding) {
          const dlqName = stagedName;
          rendered.queues = rendered.queues ?? {};
          // Only set DLQ on the consumer entry for the source queue.
          // Use state's staged name for the source queue too.
          const sourceQueueLogical = (queueBinding as { deadLetterFor: string }).deadLetterFor;
          const sourceState = state.resources[sourceQueueLogical];
          const sourceQueueLive = sourceState
            ? resourceStagedName(sourceState)
            : resourceName(sourceQueueLogical, stage);
          rendered.queues.consumers = rendered.queues.consumers?.map((c) =>
            c.queue === sourceQueueLogical || c.queue === sourceQueueLive
              ? { ...c, dead_letter_queue: dlqName }
              : c,
          );
        }
        break;
      }
    }
  }

  // Replace service binding targets
  const workerBindings = config.serviceBindings?.[workerPath];
  if (workerBindings) {
    rendered.services = Object.entries(workerBindings).map(([binding, targetWorkerPath]) => {
      const targetConfig = state.workers[targetWorkerPath];
      return {
        binding,
        service: targetConfig?.name ?? workerName("unknown", stage),
      };
    });
  }

  // Render routes with stage-specific patterns
  const routeConfig = config.routes?.[workerPath];
  if (routeConfig) {
    const resolvedPattern = routeConfig.pattern.replace(/\{stage\}/g, stage);

    if (routeConfig.customDomain) {
      const resolvedDomain = routeConfig.customDomain.replace(/\{stage\}/g, stage);
      rendered.routes = [
        { pattern: resolvedPattern, zone_name: routeConfig.zone, custom_domain: resolvedDomain },
      ];
    } else if (routeConfig.zone) {
      rendered.routes = [{ pattern: resolvedPattern, zone_name: routeConfig.zone }];
    } else {
      rendered.routes = [{ pattern: resolvedPattern }];
    }
  }

  // Final cleanup: remove any KV namespaces with placeholder IDs
  if (rendered.d1_databases) {
    rendered.d1_databases = rendered.d1_databases.filter(
      (db) => db.database_id && !db.database_id.includes("placeholder"),
    );
    if (rendered.d1_databases.length === 0) {
      delete rendered.d1_databases;
    }
  }

  if (rendered.kv_namespaces) {
    rendered.kv_namespaces = rendered.kv_namespaces.filter(
      (kv) => kv.id && !kv.id.includes("placeholder"),
    );
    if (rendered.kv_namespaces.length === 0) {
      delete rendered.kv_namespaces;
    }
  }

  if (rendered.r2_buckets) {
    rendered.r2_buckets = rendered.r2_buckets.filter((bucket) => bucket.bucket_name && !bucket.bucket_name.includes("placeholder"));
    if (rendered.r2_buckets.length === 0) {
      delete rendered.r2_buckets;
    }
  }

  // Pin account on the rendered config so `wrangler deploy -c …` targets the same account
  // as `getWranglerEnv()` (API token vs OAuth default.toml mismatch caused API error 10000).
  if (rootDir) {
    const workerDir = resolve(rootDir, workerPath);
    try {
      rendered.account_id = resolveAccountId(workerDir);
    } catch {
      const fromBase = baseConfig.account_id;
      if (typeof fromBase === "string" && fromBase.trim()) {
        rendered.account_id = fromBase.trim();
      }
    }
  }

  return rendered;
}

/**
 * Write rendered wrangler configs for all workers in a stage.
 */
export function writeRenderedConfigs(
  rootDir: string,
  stage: string,
  configs: Map<string, WranglerConfig>,
): void {
  for (const [workerPath, config] of configs) {
    // Write rendered config to .wrangler-deploy/<stage>/<workerPath>/wrangler.rendered.jsonc
    const renderedPath = join(
      rootDir,
      ".wrangler-deploy",
      stage,
      workerPath,
      "wrangler.rendered.jsonc",
    );
    mkdirSync(dirname(renderedPath), { recursive: true });
    const content = `// Auto-generated by wrangler-deploy. Do not edit.\n// Stage: ${stage} | Generated: ${new Date().toISOString()}\n${JSON.stringify(config, null, 2)}\n`;
    writeFileSync(renderedPath, content);

    // Also write override file in the worker directory
    const overridePath = join(rootDir, workerPath, `wrangler.${stage}.jsonc`);
    writeFileSync(overridePath, content);
  }
}
