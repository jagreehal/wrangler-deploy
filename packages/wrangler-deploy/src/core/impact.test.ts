import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { buildRichGraph } from "./graph-model.js";
import { analyzeImpact } from "./impact.js";
import type { CfStageConfig } from "../types.js";

// Graph: api, batch-workflow, event-router workers
// hyperdrive shared by api + batch
// cache-kv exclusive to batch
// queue: api produces, event-router consumes
// service-binding: api → batch
const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/batch-workflow", "apps/event-router"],
  resources: {
    "payments-hyperdrive": {
      type: "hyperdrive",
      bindings: { "apps/api": "DB", "apps/batch-workflow": "DB" },
    },
    "cache-kv": {
      type: "kv",
      bindings: { "apps/batch-workflow": "CACHE" },
    },
    "payment-queue": {
      type: "queue",
      bindings: {
        "apps/api": { producer: "PAYMENT_QUEUE" },
        "apps/event-router": { consumer: true },
      },
    },
  },
  serviceBindings: {
    "apps/api": { BATCH: "apps/batch-workflow" },
  },
};

describe("analyzeImpact", () => {
  it("returns upstream deps with sharedWith for a shared resource", ({ task }) => {
    story.init(task);
    story.given("a graph where api and batch both bind payments-hyperdrive");
    const graph = buildRichGraph(config);
    const result = analyzeImpact(graph, "apps/batch-workflow");

    story.then("upstream includes payments-hyperdrive sharedWith apps/api");
    const hyperdrive = result.upstream.find((u) => u.id === "payments-hyperdrive");
    expect(hyperdrive).toBeDefined();
    expect(hyperdrive?.type).toBe("hyperdrive");
    expect(hyperdrive?.sharedWith).toContain("apps/api");

    story.then("upstream includes cache-kv with empty sharedWith (exclusive to batch)");
    const cacheKv = result.upstream.find((u) => u.id === "cache-kv");
    expect(cacheKv).toBeDefined();
    expect(cacheKv?.sharedWith).toHaveLength(0);
  });

  it("returns downstream deps for workers that depend on target via service-binding", ({ task }) => {
    story.init(task);
    story.given("apps/api has a service-binding to apps/batch-workflow");
    const graph = buildRichGraph(config);
    const result = analyzeImpact(graph, "apps/batch-workflow");

    story.then("downstream includes apps/api with relationship service-binding");
    const downstream = result.downstream.find((d) => d.id === "apps/api");
    expect(downstream).toBeDefined();
    expect(downstream?.relationship).toBe("service-binding");
    expect(downstream?.label).toBe("BATCH");
  });

  it("returns consequences for each downstream dep", ({ task }) => {
    story.init(task);
    story.given("apps/api depends on apps/batch-workflow via service-binding");
    const graph = buildRichGraph(config);
    const result = analyzeImpact(graph, "apps/batch-workflow");

    story.then("consequences includes a message about apps/api losing service-binding");
    const loseMsg = result.consequences.find(
      (c) => c.includes("apps/api") && c.includes("BATCH") && c.includes("service-binding"),
    );
    expect(loseMsg).toBeDefined();
  });

  it("returns consequences for unaffected workers", ({ task }) => {
    story.init(task);
    story.given("apps/event-router has no dependency on apps/batch-workflow");
    const graph = buildRichGraph(config);
    const result = analyzeImpact(graph, "apps/batch-workflow");

    story.then("consequences includes unaffected message for event-router");
    const unaffectedMsg = result.consequences.find(
      (c) => c.includes("apps/event-router") && c.includes("unaffected"),
    );
    expect(unaffectedMsg).toBeDefined();
  });

  it("returns queue producer as upstream dep (not downstream)", ({ task }) => {
    story.init(task);
    story.given("apps/api produces to payment-queue");
    const graph = buildRichGraph(config);
    const result = analyzeImpact(graph, "apps/api");

    story.then("upstream includes payment-queue");
    const queue = result.upstream.find((u) => u.id === "payment-queue");
    expect(queue).toBeDefined();
    expect(queue?.type).toBe("queue");
  });

  it("throws when targetId is not found in graph", ({ task }) => {
    story.init(task);
    story.given("a graph without a node called apps/unknown");
    const graph = buildRichGraph(config);

    story.then("analyzeImpact throws an error");
    expect(() => analyzeImpact(graph, "apps/unknown")).toThrow();
  });

  it("sets target to the targetId", ({ task }) => {
    story.init(task);
    story.given("a valid target node");
    const graph = buildRichGraph(config);
    const result = analyzeImpact(graph, "apps/api");

    story.then("result.target equals the targetId");
    expect(result.target).toBe("apps/api");
  });
});
