import type { RichGraph } from "../graph-model.js";

export function renderJson(graph: RichGraph): string {
  return JSON.stringify(graph, null, 2);
}
