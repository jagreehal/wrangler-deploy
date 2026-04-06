import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { renderMermaid } from "./mermaid.js";
import type { RichGraph } from "../graph-model.js";

const fullGraph: RichGraph = {
  nodes: [
    { id: "apps/api", type: "worker", label: "api" },
    { id: "apps/batch-workflow", type: "worker", label: "batch-workflow" },
    { id: "cache-kv", type: "kv", label: "cache-kv" },
    { id: "payments-db", type: "d1", label: "payments-db" },
    { id: "payment-outbox", type: "queue", label: "payment-outbox" },
    { id: "my-hyperdrive", type: "hyperdrive", label: "my-hyperdrive" },
  ],
  edges: [
    { from: "apps/api", to: "cache-kv", type: "binding", label: "CACHE" },
    { from: "apps/api", to: "payments-db", type: "binding", label: "DB" },
    { from: "apps/api", to: "apps/batch-workflow", type: "service-binding", label: "WORKFLOWS" },
    { from: "apps/api", to: "payment-outbox", type: "producer", label: "OUTBOX_QUEUE" },
    { from: "apps/api", to: "my-hyperdrive", type: "binding", label: "HD" },
    { from: "payment-outbox", to: "cache-kv", type: "dead-letter" },
  ],
};

describe("renderMermaid", () => {
  it("starts with 'graph TD'", ({ task }) => {
    story.init(task);
    story.given("any graph");
    const output = renderMermaid(fullGraph);
    story.then("output starts with graph TD");
    expect(output.trimStart()).toMatch(/^graph TD/);
  });

  it("renders workers with rounded box shape", ({ task }) => {
    story.init(task);
    story.given("worker nodes");
    const output = renderMermaid(fullGraph);
    story.then("workers use ([label]) shape");
    expect(output).toMatch(/\(\[.*api.*\]\)/);
  });

  it("renders KV and D1 nodes with cylinder shape", ({ task }) => {
    story.init(task);
    story.given("kv and d1 nodes");
    const output = renderMermaid(fullGraph);
    story.then("KV and D1 use [(label)] shape");
    expect(output).toMatch(/\[.*cache-kv.*\]/);
    expect(output).toMatch(/\[.*payments-db.*\]/);
  });

  it("renders queue nodes with parallelogram shape", ({ task }) => {
    story.init(task);
    story.given("a queue node");
    const output = renderMermaid(fullGraph);
    story.then("queue uses [/label\\] shape");
    expect(output).toMatch(/\[\/.*payment-outbox.*\\\]/);
  });

  it("renders hyperdrive nodes with hexagon shape", ({ task }) => {
    story.init(task);
    story.given("a hyperdrive node");
    const output = renderMermaid(fullGraph);
    story.then("hyperdrive uses {{label}} shape");
    expect(output).toMatch(/\{\{.*my-hyperdrive.*\}\}/);
  });

  it("uses --> for service-binding and producer edges", ({ task }) => {
    story.init(task);
    story.given("service-binding and producer edges");
    const output = renderMermaid(fullGraph);
    story.then("those edges use --> arrow with label");
    expect(output).toContain("-->");
    expect(output).toContain("WORKFLOWS");
    expect(output).toContain("OUTBOX_QUEUE");
  });

  it("uses -.-> for binding edges", ({ task }) => {
    story.init(task);
    story.given("binding edges");
    const output = renderMermaid(fullGraph);
    story.then("binding edges use -.->");
    expect(output).toContain("-.->") ;
  });

  it("uses -. DLQ .-> for dead-letter edges", ({ task }) => {
    story.init(task);
    story.given("a dead-letter edge");
    const output = renderMermaid(fullGraph);
    story.then("dead-letter edge uses -. DLQ .-> syntax");
    expect(output).toContain("DLQ");
  });

  it("includes subgraphs grouping nodes by type", ({ task }) => {
    story.init(task);
    story.given("nodes of multiple types");
    const output = renderMermaid(fullGraph);
    story.then("output contains subgraph sections");
    expect(output).toContain("subgraph");
  });

  it("sanitizes node IDs with non-alphanumeric characters", ({ task }) => {
    story.init(task);
    story.given("nodes with slashes and hyphens in IDs");
    const output = renderMermaid(fullGraph);
    story.then("node IDs have non-alphanumeric chars replaced with underscores");
    expect(output).toContain("apps_api");
    expect(output).toContain("apps_batch_workflow");
  });
});
