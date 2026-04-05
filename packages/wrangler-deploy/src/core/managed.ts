import type { CfStageConfig, StageState } from "../types.js";

export interface ManagedEnvSection {
  kv_namespaces?: Array<{ binding: string; id: string }>;
  d1_databases?: Array<{ binding: string; database_id: string; database_name: string }>;
  hyperdrive?: Array<{ binding: string; id: string }>;
  queues?: { producers?: Array<{ binding: string; queue: string }> };
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  services?: Array<{ binding: string; service: string }>;
}

export function writeManagedBindings(
  workerPath: string,
  config: CfStageConfig,
  state: StageState,
): ManagedEnvSection {
  const section: ManagedEnvSection = {};

  for (const [resourceName, resource] of Object.entries(config.resources)) {
    const bindings = resource.bindings;
    const bindingForWorker = bindings[workerPath];
    if (bindingForWorker === undefined) continue;

    const resourceState = state.resources[resourceName];
    if (!resourceState?.observed.id) continue;

    const id = resourceState.observed.id;
    const desiredName = resourceState.desired.name;

    if (resource.type === "kv") {
      const bindingName = typeof bindingForWorker === "string" ? bindingForWorker : String(bindingForWorker);
      section.kv_namespaces ??= [];
      section.kv_namespaces.push({ binding: bindingName, id });
    } else if (resource.type === "d1") {
      const bindingName = typeof bindingForWorker === "string" ? bindingForWorker : String(bindingForWorker);
      section.d1_databases ??= [];
      section.d1_databases.push({ binding: bindingName, database_id: id, database_name: desiredName });
    } else if (resource.type === "hyperdrive") {
      const bindingName = typeof bindingForWorker === "string" ? bindingForWorker : String(bindingForWorker);
      section.hyperdrive ??= [];
      section.hyperdrive.push({ binding: bindingName, id });
    } else if (resource.type === "r2") {
      const bindingName = typeof bindingForWorker === "string" ? bindingForWorker : String(bindingForWorker);
      section.r2_buckets ??= [];
      section.r2_buckets.push({ binding: bindingName, bucket_name: desiredName });
    } else if (resource.type === "queue") {
      // Queue bindings can be producer or consumer
      if (
        typeof bindingForWorker === "object" &&
        bindingForWorker !== null &&
        "producer" in bindingForWorker
      ) {
        const qb = bindingForWorker as { producer: string };
        section.queues ??= {};
        section.queues.producers ??= [];
        section.queues.producers.push({ binding: qb.producer, queue: desiredName });
      }
      // Consumers don't need wrangler binding entries here (queue config handles them)
    }
  }

  // Service bindings: map target worker to its deployed name from state
  const serviceBindings = config.serviceBindings?.[workerPath];
  if (serviceBindings) {
    for (const [bindingName, targetWorkerPath] of Object.entries(serviceBindings)) {
      const targetWorkerState = state.workers[targetWorkerPath];
      if (!targetWorkerState?.name) continue;
      section.services ??= [];
      section.services.push({ binding: bindingName, service: targetWorkerState.name });
    }
  }

  return section;
}
