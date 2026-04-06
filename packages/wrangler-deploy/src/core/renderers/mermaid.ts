import type { RichGraph, RichNode, RichNodeType, RichEdge } from "../graph-model.js";

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function nodeShape(node: RichNode): string {
  const sid = sanitizeId(node.id);
  switch (node.type) {
    case "worker":
      return `${sid}([${node.label}])`;
    case "kv":
    case "d1":
    case "r2":
    case "vectorize":
      return `${sid}[(${node.label})]`;
    case "queue":
      return `${sid}[/${node.label}\\]`;
    case "hyperdrive":
      return `${sid}{{${node.label}}}`;
    default: {
      void (node.type as never);
      return `${sid}[${node.label}]`;
    }
  }
}

function edgeArrow(edge: RichEdge): string {
  const fromId = sanitizeId(edge.from);
  const toId = sanitizeId(edge.to);

  if (edge.type === "dead-letter") {
    return `${fromId} -. DLQ .-> ${toId}`;
  }

  if (edge.type === "service-binding" || edge.type === "producer" || edge.type === "consumer") {
    if (edge.label) {
      return `${fromId} -->|${edge.label}| ${toId}`;
    }
    return `${fromId} --> ${toId}`;
  }

  // binding
  if (edge.label) {
    return `${fromId} -.->|${edge.label}| ${toId}`;
  }
  return `${fromId} -.-> ${toId}`;
}

const TYPE_ORDER: RichNodeType[] = ["worker", "kv", "d1", "r2", "queue", "hyperdrive", "vectorize"];

const TYPE_LABELS: Record<RichNodeType, string> = {
  worker: "Workers",
  kv: "KV Namespaces",
  d1: "D1 Databases",
  r2: "R2 Buckets",
  queue: "Queues",
  hyperdrive: "Hyperdrive",
  vectorize: "Vectorize",
};

export function renderMermaid(graph: RichGraph): string {
  const lines: string[] = ["graph TD"];

  // Group nodes by type
  const byType = new Map<RichNodeType, RichNode[]>();
  for (const node of graph.nodes) {
    const existing = byType.get(node.type) ?? [];
    existing.push(node);
    byType.set(node.type, existing);
  }

  // Emit subgraphs in order
  for (const type of TYPE_ORDER) {
    const nodes = byType.get(type);
    if (!nodes || nodes.length === 0) continue;

    lines.push(`  subgraph ${TYPE_LABELS[type]}`);
    for (const node of nodes) {
      lines.push(`    ${nodeShape(node)}`);
    }
    lines.push("  end");
  }

  // Emit edges
  for (const edge of graph.edges) {
    lines.push(`  ${edgeArrow(edge)}`);
  }

  return lines.join("\n");
}
