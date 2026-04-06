import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { renderDot } from "./dot.js";
import type { RichGraph } from "../graph-model.js";

const graph: RichGraph = {
  nodes: [
    { id: "apps/api", type: "worker", label: "api" },
    { id: "cache-kv", type: "kv", label: "cache-kv" },
    { id: "payments-db", type: "d1", label: "payments-db" },
    { id: "payment-outbox", type: "queue", label: "payment-outbox" },
    { id: "my-hyperdrive", type: "hyperdrive", label: "my-hyperdrive" },
  ],
  edges: [
    { from: "apps/api", to: "cache-kv", type: "binding", label: "CACHE" },
    { from: "apps/api", to: "payments-db", type: "binding", label: "DB" },
    { from: "apps/api", to: "payment-outbox", type: "producer", label: "OUTBOX_QUEUE" },
    { from: "apps/api", to: "my-hyperdrive", type: "binding", label: "HD" },
    { from: "payment-outbox", to: "cache-kv", type: "dead-letter" },
  ],
};

describe("renderDot", () => {
  it("outputs a valid digraph block", ({ task }) => {
    story.init(task);
    story.given("any graph");
    const output = renderDot(graph);
    story.then("output is a digraph block");
    expect(output).toContain("digraph");
    expect(output).toContain("{");
    expect(output).toContain("}");
    expect(output).toContain("rankdir=TB");
  });

  it("contains sanitized node IDs", ({ task }) => {
    story.init(task);
    story.given("nodes with slashes and hyphens");
    const output = renderDot(graph);
    story.then("node IDs appear in the output sanitized");
    expect(output).toContain("apps_api");
    expect(output).toContain("cache_kv");
  });

  it("assigns box shape to worker nodes", ({ task }) => {
    story.init(task);
    story.given("worker nodes");
    const output = renderDot(graph);
    story.then("worker nodes have shape=box");
    expect(output).toContain("shape=box");
  });

  it("assigns cylinder shape to KV and D1 nodes", ({ task }) => {
    story.init(task);
    story.given("kv and d1 nodes");
    const output = renderDot(graph);
    story.then("kv and d1 nodes have shape=cylinder");
    expect(output).toContain("shape=cylinder");
  });

  it("assigns parallelogram shape to queue nodes", ({ task }) => {
    story.init(task);
    story.given("a queue node");
    const output = renderDot(graph);
    story.then("queue nodes have shape=parallelogram");
    expect(output).toContain("shape=parallelogram");
  });

  it("assigns hexagon shape to hyperdrive nodes", ({ task }) => {
    story.init(task);
    story.given("a hyperdrive node");
    const output = renderDot(graph);
    story.then("hyperdrive nodes have shape=hexagon");
    expect(output).toContain("shape=hexagon");
  });

  it("includes edge labels", ({ task }) => {
    story.init(task);
    story.given("edges with labels");
    const output = renderDot(graph);
    story.then("edge labels appear in the output");
    expect(output).toContain("CACHE");
    expect(output).toContain("DB");
    expect(output).toContain("OUTBOX_QUEUE");
  });

  it("renders dead-letter edges with style=dashed", ({ task }) => {
    story.init(task);
    story.given("a dead-letter edge");
    const output = renderDot(graph);
    story.then("dead-letter edges have style=dashed");
    expect(output).toContain("style=dashed");
  });
});
