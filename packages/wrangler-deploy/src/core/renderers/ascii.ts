import type { RichGraph, RichNode, RichEdge } from "../graph-model.js";

function nodeLabel(node: RichNode): string {
  const parts: string[] = [`[${node.type}] ${node.label}`];
  if (node.deployedName) {
    parts.push(`deployed: ${node.deployedName}`);
  }
  if (node.resourceId) {
    parts.push(`id: ${node.resourceId}`);
  }
  if (node.status) {
    parts.push(`status: ${node.status}`);
  }
  return parts.join(" | ");
}

function edgeLabel(edge: RichEdge): string {
  const parts: string[] = [edge.type];
  if (edge.label) {
    parts.push(edge.label);
  }
  return parts.join(": ");
}

export function renderAscii(graph: RichGraph): string {
  const lines: string[] = [];

  // Build adjacency: for each node, its outgoing edges
  const outgoing = new Map<string, RichEdge[]>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    const existing = outgoing.get(edge.from) ?? [];
    existing.push(edge);
    outgoing.set(edge.from, existing);
  }

  const nodeById = new Map<string, RichNode>(graph.nodes.map((n) => [n.id, n]));

  // Render workers first, then remaining nodes
  const workers = graph.nodes.filter((n) => n.type === "worker");
  const nonWorkers = graph.nodes.filter((n) => n.type !== "worker");

  // Track which non-worker nodes are reachable from workers (to avoid duplicating standalone nodes)
  const referencedFromWorker = new Set<string>();
  for (const worker of workers) {
    for (const edge of outgoing.get(worker.id) ?? []) {
      referencedFromWorker.add(edge.to);
    }
  }

  for (const worker of workers) {
    lines.push(nodeLabel(worker));
    const edges = outgoing.get(worker.id) ?? [];
    edges.forEach((edge, i) => {
      const isLast = i === edges.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      const target = nodeById.get(edge.to);
      const targetStr = target ? nodeLabel(target) : edge.to;
      lines.push(`${prefix}(${edgeLabel(edge)}) ${targetStr}`);
    });
  }

  // Render non-worker nodes that have their own outgoing edges and weren't listed above
  for (const node of nonWorkers) {
    const edges = outgoing.get(node.id) ?? [];
    if (edges.length === 0) continue;
    // Only show if it has outgoing edges (e.g. dead-letter queue pointing to DLQ)
    lines.push(nodeLabel(node));
    edges.forEach((edge, i) => {
      const isLast = i === edges.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      const target = nodeById.get(edge.to);
      const targetStr = target ? nodeLabel(target) : edge.to;
      lines.push(`${prefix}(${edgeLabel(edge)}) ${targetStr}`);
    });
  }

  // List any standalone non-worker nodes with no outgoing edges and not already shown as children
  const shownAsParent = new Set([
    ...workers.map((w) => w.id),
    ...nonWorkers.filter((n) => (outgoing.get(n.id) ?? []).length > 0).map((n) => n.id),
  ]);

  const standalone = nonWorkers.filter(
    (n) => (outgoing.get(n.id) ?? []).length === 0 && !shownAsParent.has(n.id),
  );

  if (standalone.length > 0) {
    lines.push("");
    lines.push("Resources:");
    for (const node of standalone) {
      lines.push(`  • ${nodeLabel(node)}`);
    }
  }

  return lines.join("\n");
}
