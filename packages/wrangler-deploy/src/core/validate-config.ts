import type { CfStageConfig, QueueResourceConfig } from "../types.js";

/**
 * Validates a CfStageConfig and returns an array of error strings.
 * An empty array means the config is valid.
 */
export function validateConfig(config: CfStageConfig): string[] {
  const errors: string[] = [];
  const workerSet = new Set(config.workers);
  const resourceSet = new Set(Object.keys(config.resources));

  // Check resource bindings reference valid workers
  for (const [resourceName, resource] of Object.entries(config.resources)) {
    for (const workerPath of Object.keys(resource.bindings)) {
      if (!workerSet.has(workerPath)) {
        errors.push(
          `Resource "${resourceName}" has binding for unknown worker "${workerPath}"`,
        );
      }
    }

    // Check DLQ references exist as resources (only for queue resources)
    if (resource.type === "queue") {
      const queueResource = resource as QueueResourceConfig;
      for (const [_workerPath, binding] of Object.entries(queueResource.bindings)) {
        if (
          typeof binding === "object" &&
          binding !== null &&
          "deadLetterFor" in binding
        ) {
          const dlqRef = (binding as { deadLetterFor: string }).deadLetterFor;
          if (!resourceSet.has(dlqRef)) {
            errors.push(
              `Resource "${resourceName}" has deadLetterFor referencing unknown resource "${dlqRef}"`,
            );
          } else {
            const dlqResource = config.resources[dlqRef];
            if (dlqResource && dlqResource.type !== "queue") {
              errors.push(
                `Resource "${resourceName}" has deadLetterFor referencing "${dlqRef}" which is type "${dlqResource.type}", not a queue`,
              );
            }
          }
        }
      }
    }
  }

  // Check service binding sources/targets are valid workers
  if (config.serviceBindings) {
    for (const [sourceWorker, bindings] of Object.entries(config.serviceBindings)) {
      if (!workerSet.has(sourceWorker)) {
        errors.push(
          `serviceBindings has unknown source worker "${sourceWorker}"`,
        );
      }
      for (const [_bindingName, targetWorker] of Object.entries(bindings)) {
        if (!workerSet.has(targetWorker)) {
          errors.push(
            `serviceBinding "${sourceWorker}" → "${_bindingName}" targets unknown worker "${targetWorker}"`,
          );
        }
      }
    }

    // Check for circular service bindings using DFS with inStack tracking
    const circularErrors = detectCircularServiceBindings(config);
    errors.push(...circularErrors);
  }

  return errors;
}

function detectCircularServiceBindings(config: CfStageConfig): string[] {
  const errors: string[] = [];
  const serviceBindings = config.serviceBindings ?? {};

  // Build adjacency list: worker -> list of workers it depends on via service bindings
  const adj: Record<string, string[]> = {};
  for (const worker of config.workers) {
    adj[worker] = [];
  }
  for (const [sourceWorker, bindings] of Object.entries(serviceBindings)) {
    for (const targetWorker of Object.values(bindings)) {
      if (!adj[sourceWorker]) adj[sourceWorker] = [];
      adj[sourceWorker].push(targetWorker);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    inStack.add(node);

    for (const neighbor of adj[node] ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (inStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = cycleStart >= 0
          ? [...path.slice(cycleStart), neighbor]
          : [...path, neighbor];
        errors.push(`Circular service binding detected: ${cycle.join(" → ")}`);
      }
    }

    inStack.delete(node);
  }

  for (const worker of config.workers) {
    if (!visited.has(worker)) {
      dfs(worker, [worker]);
    }
  }

  return errors;
}
