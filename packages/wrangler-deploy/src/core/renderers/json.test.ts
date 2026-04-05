import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { renderJson } from "./json.js";
import type { RichGraph } from "../graph-model.js";

const graph: RichGraph = {
  nodes: [
    { id: "apps/api", type: "worker", label: "api" },
    { id: "cache-kv", type: "kv", label: "cache-kv" },
  ],
  edges: [
    { from: "apps/api", to: "cache-kv", type: "binding", label: "CACHE" },
  ],
};

describe("renderJson", () => {
  it("returns a parseable JSON string", ({ task }) => {
    story.init(task);
    story.given("a graph with nodes and edges");
    const output = renderJson(graph);
    story.then("the output is valid JSON");
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("parsed output contains nodes array", ({ task }) => {
    story.init(task);
    story.given("a graph with two nodes");
    const parsed = JSON.parse(renderJson(graph));
    story.then("parsed JSON has a nodes array");
    expect(parsed).toHaveProperty("nodes");
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes).toHaveLength(2);
  });

  it("parsed output contains edges array", ({ task }) => {
    story.init(task);
    story.given("a graph with one edge");
    const parsed = JSON.parse(renderJson(graph));
    story.then("parsed JSON has an edges array");
    expect(parsed).toHaveProperty("edges");
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(parsed.edges).toHaveLength(1);
  });

  it("preserves all node fields", ({ task }) => {
    story.init(task);
    story.given("a node with id, type, and label");
    const parsed = JSON.parse(renderJson(graph));
    story.then("the node fields are preserved");
    const apiNode = parsed.nodes.find((n: { id: string }) => n.id === "apps/api");
    expect(apiNode).toBeDefined();
    expect(apiNode.type).toBe("worker");
    expect(apiNode.label).toBe("api");
  });

  it("is pretty-printed with 2-space indentation", ({ task }) => {
    story.init(task);
    story.given("any graph");
    const output = renderJson(graph);
    story.then("output is formatted with 2-space indentation");
    expect(output).toContain("  ");
    expect(output.split("\n").length).toBeGreaterThan(1);
  });
});
