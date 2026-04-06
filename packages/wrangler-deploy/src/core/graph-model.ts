import type { CfStageConfig, StageState } from "../types.js";

export type RichNodeType = "worker" | "kv" | "queue" | "d1" | "hyperdrive" | "r2" | "vectorize";

export interface RichNode {
  id: string;
  type: RichNodeType;
  label: string;
  resourceId?: string;
  status?: "active" | "missing" | "drifted" | "orphaned";
  deployedName?: string;
}

export type RichEdgeType = "service-binding" | "binding" | "producer" | "consumer" | "dead-letter";

export interface RichEdge {
  from: string;
  to: string;
  type: RichEdgeType;
  label?: string;
}

export interface RichGraph {
  nodes: RichNode[];
  edges: RichEdge[];
}

export function buildRichGraph(config: CfStageConfig, state?: StageState): RichGraph {
  const nodes: RichNode[] = [];
  const edges: RichEdge[] = [];

  // Worker nodes — label is the last segment of the path
  for (const workerPath of config.workers) {
    const segments = workerPath.split("/");
    const label = segments[segments.length - 1] ?? workerPath;
    const workerState = state?.workers[workerPath];
    nodes.push({
      id: workerPath,
      type: "worker",
      label,
      ...(workerState?.name !== undefined ? { deployedName: workerState.name } : {}),
    });
  }

  // Resource nodes + edges from worker bindings
  for (const [resourceName, resource] of Object.entries(config.resources)) {
    const resourceState = state?.resources[resourceName];
    const node: RichNode = {
      id: resourceName,
      type: resource.type,
      label: resourceName,
      ...(resourceState?.observed.id !== undefined ? { resourceId: resourceState.observed.id } : {}),
      ...(resourceState?.observed.status !== undefined ? { status: resourceState.observed.status } : {}),
    };
    nodes.push(node);

    if (resource.type === "queue") {
      for (const [workerPath, binding] of Object.entries(resource.bindings)) {
        if (typeof binding === "string") {
          // Treat plain string bindings as producer edges
          edges.push({ from: workerPath, to: resourceName, type: "producer", label: binding });
        } else if ("deadLetterFor" in binding) {
          // dead-letter: edge goes from the source queue to this DLQ
          edges.push({ from: binding.deadLetterFor, to: resourceName, type: "dead-letter" });
        } else {
          // QueueProducerBinding or QueueConsumerBinding
          if ("producer" in binding && binding.producer !== undefined) {
            edges.push({ from: workerPath, to: resourceName, type: "producer", label: binding.producer });
          }
          if ("consumer" in binding && binding.consumer === true) {
            edges.push({ from: workerPath, to: resourceName, type: "consumer" });
          }
        }
      }
    } else {
      // Non-queue resources: "binding" edges from worker to resource
      for (const [workerPath, bindingName] of Object.entries(resource.bindings)) {
        edges.push({ from: workerPath, to: resourceName, type: "binding", label: bindingName });
      }
    }
  }

  // Service binding edges between workers
  if (config.serviceBindings) {
    for (const [sourceWorker, bindings] of Object.entries(config.serviceBindings)) {
      for (const [bindingName, targetWorker] of Object.entries(bindings)) {
        edges.push({ from: sourceWorker, to: targetWorker, type: "service-binding", label: bindingName });
      }
    }
  }

  return { nodes, edges };
}
