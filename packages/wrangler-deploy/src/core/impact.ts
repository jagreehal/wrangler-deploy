import type { RichGraph } from "./graph-model.js";

export interface UpstreamDep {
  id: string;
  type: string;
  sharedWith: string[];
}

export interface DownstreamDep {
  id: string;
  relationship: string;
  label?: string;
}

export interface ImpactResult {
  target: string;
  upstream: UpstreamDep[];
  downstream: DownstreamDep[];
  consequences: string[];
}

export function analyzeImpact(graph: RichGraph, targetId: string): ImpactResult {
  const targetNode = graph.nodes.find((n) => n.id === targetId);
  if (!targetNode) {
    throw new Error(`Node not found in graph: ${targetId}`);
  }

  // Upstream: resources the target depends on (outgoing edges from target to non-worker nodes)
  const upstreamEdges = graph.edges.filter((e) => e.from === targetId);
  const upstreamNonWorker = upstreamEdges.filter((e) => {
    const toNode = graph.nodes.find((n) => n.id === e.to);
    return toNode && toNode.type !== "worker";
  });

  const upstream: UpstreamDep[] = upstreamNonWorker.map((edge) => {
    const resourceNode = graph.nodes.find((n) => n.id === edge.to)!;
    // Find other workers that also bind to this resource
    const otherBindings = graph.edges.filter(
      (e) => e.to === edge.to && e.from !== targetId,
    );
    const sharedWith = otherBindings
      .map((e) => e.from)
      .filter((fromId) => {
        const fromNode = graph.nodes.find((n) => n.id === fromId);
        return fromNode && fromNode.type === "worker";
      })
      .filter((id, index, arr) => arr.indexOf(id) === index); // deduplicate

    return {
      id: edge.to,
      type: resourceNode.type,
      sharedWith,
    };
  });

  // Downstream: workers that depend on target (incoming edges to target from worker nodes)
  const downstreamEdges = graph.edges.filter((e) => e.to === targetId);
  const downstreamWorkerEdges = downstreamEdges.filter((e) => {
    const fromNode = graph.nodes.find((n) => n.id === e.from);
    return fromNode && fromNode.type === "worker";
  });

  const downstream: DownstreamDep[] = downstreamWorkerEdges.map((edge) => ({
    id: edge.from,
    relationship: edge.type,
    ...(edge.label !== undefined ? { label: edge.label } : {}),
  }));

  // All other workers (not target, not already in downstream)
  const downstreamIds = new Set(downstream.map((d) => d.id));
  const allWorkers = graph.nodes.filter(
    (n) => n.type === "worker" && n.id !== targetId,
  );
  const unaffectedWorkers = allWorkers.filter((w) => !downstreamIds.has(w.id));

  const consequences: string[] = [
    ...downstream.map((dep) => {
      const label = dep.label ? ` ${dep.label}` : "";
      return `${dep.id} loses${label} ${dep.relationship} (calls will fail)`;
    }),
    ...unaffectedWorkers.map(
      (w) => `${w.id} is unaffected (no direct dependency)`,
    ),
  ];

  return {
    target: targetId,
    upstream,
    downstream,
    consequences,
  };
}
