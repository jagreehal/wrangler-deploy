import type { RichGraph, RichNode, RichNodeType, RichEdge } from "../graph-model.js";

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function nodeShape(type: RichNodeType): string {
  switch (type) {
    case "worker":
      return "box";
    case "kv":
    case "d1":
    case "r2":
    case "vectorize":
      return "cylinder";
    case "queue":
      return "parallelogram";
    case "hyperdrive":
      return "hexagon";
    default: {
      void (type as never);
      return "box";
    }
  }
}

function renderNode(node: RichNode): string {
  const sid = sanitizeId(node.id);
  const shape = nodeShape(node.type);
  return `  ${sid} [label="${node.label}", shape=${shape}];`;
}

function renderEdge(edge: RichEdge): string {
  const fromId = sanitizeId(edge.from);
  const toId = sanitizeId(edge.to);

  const attrs: string[] = [];
  if (edge.label) {
    attrs.push(`label="${edge.label}"`);
  }
  if (edge.type === "dead-letter") {
    attrs.push("style=dashed");
    if (!edge.label) {
      attrs.push('label="DLQ"');
    }
  }

  const attrStr = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
  return `  ${fromId} -> ${toId}${attrStr};`;
}

export function renderDot(graph: RichGraph): string {
  const lines: string[] = ["digraph {", "  rankdir=TB;", ""];

  for (const node of graph.nodes) {
    lines.push(renderNode(node));
  }

  lines.push("");

  for (const edge of graph.edges) {
    lines.push(renderEdge(edge));
  }

  lines.push("}");
  return lines.join("\n");
}
