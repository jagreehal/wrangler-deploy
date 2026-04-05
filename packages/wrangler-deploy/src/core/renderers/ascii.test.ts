import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { renderAscii } from "./ascii.js";
import type { RichGraph } from "../graph-model.js";

const twoWorkerGraph: RichGraph = {
  nodes: [
    { id: "apps/api", type: "worker", label: "api" },
    { id: "apps/batch-workflow", type: "worker", label: "batch-workflow" },
    { id: "cache-kv", type: "kv", label: "cache-kv" },
    { id: "payments-db", type: "d1", label: "payments-db" },
  ],
  edges: [
    { from: "apps/api", to: "cache-kv", type: "binding", label: "CACHE" },
    { from: "apps/api", to: "payments-db", type: "binding", label: "DB" },
    { from: "apps/api", to: "apps/batch-workflow", type: "service-binding", label: "WORKFLOWS" },
    { from: "apps/batch-workflow", to: "payments-db", type: "binding", label: "DB" },
  ],
};

describe("renderAscii", () => {
  it("includes worker names in the output", ({ task }) => {
    story.init(task);
    story.given("a graph with two workers");
    const output = renderAscii(twoWorkerGraph);
    story.then("output contains both worker labels");
    expect(output).toContain("api");
    expect(output).toContain("batch-workflow");
  });

  it("includes resource names in the output", ({ task }) => {
    story.init(task);
    story.given("a graph with KV and D1 resources");
    const output = renderAscii(twoWorkerGraph);
    story.then("output contains resource names");
    expect(output).toContain("cache-kv");
    expect(output).toContain("payments-db");
  });

  it("includes edge labels (binding names) in the output", ({ task }) => {
    story.init(task);
    story.given("edges with binding name labels");
    const output = renderAscii(twoWorkerGraph);
    story.then("output contains the binding labels");
    expect(output).toContain("CACHE");
    expect(output).toContain("DB");
    expect(output).toContain("WORKFLOWS");
  });

  it("uses tree structure prefixes", ({ task }) => {
    story.init(task);
    story.given("a multi-node graph");
    const output = renderAscii(twoWorkerGraph);
    story.then("output contains tree structure characters");
    expect(output).toMatch(/[├└]/);
    expect(output).toContain("──");
  });

  it("includes resource type labels", ({ task }) => {
    story.init(task);
    story.given("a graph with kv and d1 resources");
    const output = renderAscii(twoWorkerGraph);
    story.then("output shows the resource type");
    expect(output).toMatch(/kv|KV/);
    expect(output).toMatch(/d1|D1/);
  });

  it("shows deployedName and resourceId when present in state-enriched nodes", ({ task }) => {
    story.init(task);
    story.given("a graph with state-enriched nodes");
    const enrichedGraph: RichGraph = {
      nodes: [
        { id: "apps/api", type: "worker", label: "api", deployedName: "dev-api" },
        { id: "payments-db", type: "d1", label: "payments-db", resourceId: "db-abc123", status: "active" },
      ],
      edges: [
        { from: "apps/api", to: "payments-db", type: "binding", label: "DB" },
      ],
    };
    const output = renderAscii(enrichedGraph);
    story.then("output shows deployed name and resource id");
    expect(output).toContain("dev-api");
    expect(output).toContain("db-abc123");
    expect(output).toContain("active");
  });
});
