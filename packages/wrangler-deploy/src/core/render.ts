import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { CfStageConfig, StageState, WranglerConfig, QueueBinding } from "../types.js";
import { resourceId, resourceStagedName } from "../types.js";
import { resourceName, workerName } from "./naming.js";

/**
 * Generate a rendered wrangler config for a worker at a given stage.
 * This is a complete, self-contained config that can be passed to
 * `wrangler deploy -c <path>`.
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

  // Make main path absolute so wrangler finds it regardless of cwd
  if (rendered.main && rootDir) {
    rendered.main = resolve(rootDir, workerPath, rendered.main);
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
