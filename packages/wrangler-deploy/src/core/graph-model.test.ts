import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { buildRichGraph } from "./graph-model.js";
import type { CfStageConfig } from "../types.js";
import type { StageState } from "../types.js";

const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/batch-workflow", "apps/event-router"],
  resources: {
    "payments-db": { type: "d1", bindings: { "apps/api": "DB", "apps/batch-workflow": "DB" } },
    "cache-kv": { type: "kv", bindings: { "apps/api": "CACHE" } },
    "payment-outbox": {
      type: "queue",
      bindings: {
        "apps/api": { producer: "OUTBOX_QUEUE" },
        "apps/event-router": { producer: "OUTBOX_QUEUE", consumer: true },
      },
    },
    "payment-outbox-dlq": {
      type: "queue",
      bindings: { "apps/event-router": { deadLetterFor: "payment-outbox" } },
    },
  },
  serviceBindings: { "apps/api": { WORKFLOWS: "apps/batch-workflow" } },
};

describe("buildRichGraph", () => {
  it("creates nodes for all workers and resources", ({ task }) => {
    story.init(task);
    story.given("a config with 3 workers and 4 resources");
    const graph = buildRichGraph(config);
    story.then("graph has 7 nodes total");
    expect(graph.nodes).toHaveLength(7);

    const workerNodes = graph.nodes.filter((n) => n.type === "worker");
    const resourceNodes = graph.nodes.filter((n) => n.type !== "worker");
    expect(workerNodes).toHaveLength(3);
    expect(resourceNodes).toHaveLength(4);
  });

  it("sets worker node labels to the last path segment", ({ task }) => {
    story.init(task);
    story.given("workers with path-based ids");
    const graph = buildRichGraph(config);
    story.then("label is the last segment of the path");
    const apiNode = graph.nodes.find((n) => n.id === "apps/api");
    expect(apiNode?.label).toBe("api");
    const batchNode = graph.nodes.find((n) => n.id === "apps/batch-workflow");
    expect(batchNode?.label).toBe("batch-workflow");
  });

  it("creates service-binding edges with binding name as label", ({ task }) => {
    story.init(task);
    story.given("apps/api has a service binding WORKFLOWS -> apps/batch-workflow");
    const graph = buildRichGraph(config);
    story.then("a service-binding edge exists from api to batch-workflow with label WORKFLOWS");
    const edge = graph.edges.find(
      (e) => e.type === "service-binding" && e.from === "apps/api" && e.to === "apps/batch-workflow",
    );
    expect(edge).toBeDefined();
    expect(edge?.label).toBe("WORKFLOWS");
  });

  it("creates producer edges for queue producer bindings", ({ task }) => {
    story.init(task);
    story.given("apps/api binds to payment-outbox as a producer");
    const graph = buildRichGraph(config);
    story.then("a producer edge exists from apps/api to payment-outbox");
    const edge = graph.edges.find(
      (e) => e.type === "producer" && e.from === "apps/api" && e.to === "payment-outbox",
    );
    expect(edge).toBeDefined();
    expect(edge?.label).toBe("OUTBOX_QUEUE");
  });

  it("creates consumer edges for queue consumer bindings", ({ task }) => {
    story.init(task);
    story.given("apps/event-router binds to payment-outbox with consumer: true");
    const graph = buildRichGraph(config);
    story.then("a consumer edge exists from apps/event-router to payment-outbox");
    const edge = graph.edges.find(
      (e) => e.type === "consumer" && e.from === "apps/event-router" && e.to === "payment-outbox",
    );
    expect(edge).toBeDefined();
  });

  it("creates dead-letter edges for DLQ bindings", ({ task }) => {
    story.init(task);
    story.given("payment-outbox-dlq has a deadLetterFor binding referencing payment-outbox");
    const graph = buildRichGraph(config);
    story.then("a dead-letter edge exists from payment-outbox to payment-outbox-dlq");
    const edge = graph.edges.find(
      (e) => e.type === "dead-letter" && e.from === "payment-outbox" && e.to === "payment-outbox-dlq",
    );
    expect(edge).toBeDefined();
  });

  it("creates binding edges for shared D1 resource bound to multiple workers", ({ task }) => {
    story.init(task);
    story.given("payments-db is bound to both apps/api and apps/batch-workflow");
    const graph = buildRichGraph(config);
    story.then("two binding edges exist from each worker to payments-db");
    const apiEdge = graph.edges.find(
      (e) => e.type === "binding" && e.from === "apps/api" && e.to === "payments-db",
    );
    const batchEdge = graph.edges.find(
      (e) => e.type === "binding" && e.from === "apps/batch-workflow" && e.to === "payments-db",
    );
    expect(apiEdge).toBeDefined();
    expect(apiEdge?.label).toBe("DB");
    expect(batchEdge).toBeDefined();
    expect(batchEdge?.label).toBe("DB");
  });

  it("overlays state when provided", ({ task }) => {
    story.init(task);
    story.given("a StageState with resource ids, statuses, and worker deployed names");

    const state: StageState = {
      stage: "dev",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      resources: {
        "payments-db": {
          type: "d1",
          desired: { name: "dev-payments-db" },
          observed: { id: "db-abc123", status: "active" },
          source: "managed",
        },
        "cache-kv": {
          type: "kv",
          desired: { name: "dev-cache-kv" },
          observed: { status: "missing" },
          source: "managed",
        },
        "payment-outbox": {
          type: "queue",
          desired: { name: "dev-payment-outbox" },
          observed: { id: "q-xyz789", status: "active" },
          source: "managed",
        },
        "payment-outbox-dlq": {
          type: "queue",
          desired: { name: "dev-payment-outbox-dlq" },
          observed: { status: "missing" },
          source: "managed",
        },
      },
      workers: {
        "apps/api": { name: "dev-api", deployed: true },
        "apps/batch-workflow": { name: "dev-batch-workflow", deployed: false },
        "apps/event-router": { name: "dev-event-router", deployed: true },
      },
      secrets: {},
    };

    const graph = buildRichGraph(config, state);

    story.then("resource nodes have resourceId and status from state");
    const dbNode = graph.nodes.find((n) => n.id === "payments-db");
    expect(dbNode?.resourceId).toBe("db-abc123");
    expect(dbNode?.status).toBe("active");

    const kvNode = graph.nodes.find((n) => n.id === "cache-kv");
    expect(kvNode?.status).toBe("missing");
    expect(kvNode?.resourceId).toBeUndefined();

    story.then("worker nodes have deployedName from state");
    const apiNode = graph.nodes.find((n) => n.id === "apps/api");
    expect(apiNode?.deployedName).toBe("dev-api");
  });
});
