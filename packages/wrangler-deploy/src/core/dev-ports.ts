import type { CfStageConfig } from "../types.js";
import { resolveDeployOrder } from "./graph.js";

/**
 * Assign local dev ports to each worker.
 * Overrides are applied first; remaining workers are auto-assigned
 * incrementally from basePort, skipping any ports already in use.
 */
export function assignPorts(
  config: CfStageConfig,
  basePort: number,
  overrides?: Record<string, number>,
): Record<string, number> {
  const order = resolveDeployOrder(config);
  const result: Record<string, number> = {};
  const usedPorts = new Set<number>(overrides ? Object.values(overrides) : []);

  // Apply overrides first
  if (overrides) {
    for (const [worker, port] of Object.entries(overrides)) {
      result[worker] = port;
    }
  }

  // Auto-assign remaining workers
  let next = basePort;
  for (const worker of order) {
    if (worker in result) continue;

    while (usedPorts.has(next)) {
      next++;
    }

    result[worker] = next;
    usedPorts.add(next);
    next++;
  }

  return result;
}
