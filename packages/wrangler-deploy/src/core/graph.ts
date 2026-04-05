import type { CfStageConfig } from "../types.js";

export interface GraphNode {
  id: string;
  type: "worker" | "resource";
  dependsOn: string[];
}

/**
 * Build a dependency graph from the manifest.
 * Workers depend on the resources they bind to and on service binding targets.
 * Resources may depend on other resources (e.g. DLQ depends on its source queue).
 */
export function buildGraph(config: CfStageConfig): GraphNode[] {
  const nodes: GraphNode[] = [];

  // Add resource nodes
  for (const [name, resource] of Object.entries(config.resources)) {
    const deps: string[] = [];

    // DLQ queues depend on the queue they're a DLQ for
    if (resource.type === "queue") {
      for (const binding of Object.values(resource.bindings)) {
        if (typeof binding === "object" && "deadLetterFor" in binding) {
          deps.push(binding.deadLetterFor);
        }
      }
    }

    nodes.push({ id: name, type: "resource", dependsOn: deps });
  }

  // Add worker nodes
  for (const workerPath of config.workers) {
    const deps: string[] = [];

    // Depend on resources bound to this worker
    for (const [resourceName, resource] of Object.entries(config.resources)) {
      if (workerPath in resource.bindings) {
        deps.push(resourceName);
      }
    }

    // Depend on service binding targets
    const bindings = config.serviceBindings?.[workerPath];
    if (bindings) {
      for (const targetWorker of Object.values(bindings)) {
        deps.push(targetWorker);
      }
    }

    nodes.push({ id: workerPath, type: "worker", dependsOn: deps });
  }

  return nodes;
}

/**
 * Validate that all dependency targets exist in the graph.
 * Throws if a node references a dependency that isn't in the graph.
 */
export function validateGraph(nodes: GraphNode[]): void {
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) {
        throw new Error(
          `Invalid dependency: "${node.id}" depends on "${dep}" which is not declared in the config. ` +
          `Check that "${dep}" exists in workers or resources.`
        );
      }
    }
  }
}

/**
 * Topological sort of graph nodes. Returns nodes in dependency order
 * (dependencies first). Detects cycles and throws.
 */
export function topologicalSort(nodes: GraphNode[]): GraphNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const inStack = new Set<string>(); // tracks active recursion for cycle detection
  const result: GraphNode[] = [];

  function visit(id: string, path: string[]) {
    if (inStack.has(id)) {
      const cycle = [...path.slice(path.indexOf(id)), id];
      throw new Error(
        `Circular dependency detected: ${cycle.join(" -> ")}. ` +
        `Break the cycle by removing a service binding or restructuring the dependency.`
      );
    }

    if (visited.has(id)) return;
    inStack.add(id);

    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.dependsOn) {
        visit(dep, [...path, id]);
      }
      result.push(node);
    }

    inStack.delete(id);
    visited.add(id);
  }

  for (const node of nodes) {
    visit(node.id, []);
  }

  return result;
}

/**
 * Validate that an explicit deploy order doesn't violate the dependency graph.
 * Throws if a worker is scheduled before a worker it depends on via service bindings.
 */
export function validateDeployOrder(order: string[], config: CfStageConfig): void {
  if (!config.serviceBindings) return;

  const position = new Map(order.map((id, i) => [id, i]));

  for (const [workerPath, bindings] of Object.entries(config.serviceBindings)) {
    const workerPos = position.get(workerPath);
    if (workerPos === undefined) continue;

    for (const [bindingName, targetWorker] of Object.entries(bindings)) {
      const targetPos = position.get(targetWorker);
      if (targetPos === undefined) continue;

      if (targetPos > workerPos) {
        throw new Error(
          `Invalid deployOrder: "${workerPath}" is scheduled before "${targetWorker}" ` +
          `but depends on it via service binding "${bindingName}". ` +
          `Move "${targetWorker}" earlier in deployOrder, or remove deployOrder to auto-infer.`
        );
      }
    }
  }
}

/**
 * Resolve the deploy order for workers.
 * Uses explicit deployOrder if provided (validated against the dependency graph),
 * otherwise infers from the dependency graph (service bindings and resource bindings).
 * Workers that are depended on deploy first.
 *
 * Validates the graph in both paths: rejects cycles, unknown targets, and
 * explicit orders that violate service binding dependencies.
 */
export function resolveDeployOrder(config: CfStageConfig): string[] {
  if (config.deployOrder && config.deployOrder.length > 0) {
    validateDeployOrder(config.deployOrder, config);

    // Ensure deployOrder and config.workers match exactly
    const ordered = new Set(config.deployOrder);
    const declared = new Set(config.workers);

    const missing = config.workers.filter((w) => !ordered.has(w));
    if (missing.length > 0) {
      throw new Error(
        `deployOrder is missing workers: ${missing.join(", ")}. ` +
        `All workers in config.workers must be listed, or remove deployOrder to auto-infer.`
      );
    }

    const extras = config.deployOrder.filter((w) => !declared.has(w));
    if (extras.length > 0) {
      throw new Error(
        `deployOrder contains unknown workers: ${extras.join(", ")}. ` +
        `Every entry must be declared in config.workers.`
      );
    }

    return config.deployOrder;
  }

  const graph = buildGraph(config);
  validateGraph(graph);
  const sorted = topologicalSort(graph);
  return sorted
    .filter((n) => n.type === "worker")
    .map((n) => n.id);
}
