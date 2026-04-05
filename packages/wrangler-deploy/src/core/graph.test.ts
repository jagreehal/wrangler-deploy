import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { buildGraph, topologicalSort, validateGraph, resolveDeployOrder } from "./graph.js";
import type { CfStageConfig } from "../types.js";

describe("buildGraph", () => {
  it("creates worker nodes with service binding edges", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api", "apps/worker"],
      resources: {},
      serviceBindings: {
        "apps/api": { BACKEND: "apps/worker" },
      },
    };

    story.given("a config with apps/api binding to apps/worker");
    const graph = buildGraph(config);

    story.then("api node depends on worker node");
    const apiNode = graph.find((n) => n.id === "apps/api");
    expect(apiNode?.dependsOn).toContain("apps/worker");
  });

  it("creates resource nodes with DLQ edges", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: [],
      resources: {
        outbox: { type: "queue", bindings: {} },
        "outbox-dlq": {
          type: "queue",
          bindings: { "apps/router": { deadLetterFor: "outbox" } },
        },
      },
    };

    story.given("a DLQ resource referencing a source queue");
    const graph = buildGraph(config);

    story.then("DLQ node depends on source queue");
    const dlqNode = graph.find((n) => n.id === "outbox-dlq");
    expect(dlqNode?.dependsOn).toContain("outbox");
  });

  it("creates worker-to-resource edges from bindings", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        cache: { type: "kv", bindings: { "apps/api": "CACHE" } },
      },
    };

    story.given("a worker with a KV binding");
    const graph = buildGraph(config);

    story.then("worker node depends on resource");
    const apiNode = graph.find((n) => n.id === "apps/api");
    expect(apiNode?.dependsOn).toContain("cache");
  });
});

describe("validateGraph", () => {
  it("passes for a valid graph", ({ task }) => {
    story.init(task);

    const nodes = [
      { id: "a", type: "worker" as const, dependsOn: ["b"] },
      { id: "b", type: "worker" as const, dependsOn: [] },
    ];

    story.given("a valid graph with proper dependencies");
    story.then("validation passes without error");
    expect(() => validateGraph(nodes)).not.toThrow();
  });

  it("throws for an unknown dependency target", ({ task }) => {
    story.init(task);

    const nodes = [{ id: "apps/api", type: "worker" as const, dependsOn: ["apps/missing"] }];

    story.given("a graph referencing an unknown node");
    story.then("validation throws an error");
    expect(() => validateGraph(nodes)).toThrow(
      'Invalid dependency: "apps/api" depends on "apps/missing" which is not declared',
    );
  });
});

describe("topologicalSort", () => {
  it("sorts dependencies before dependents", ({ task }) => {
    story.init(task);

    const nodes = [
      { id: "a", type: "worker" as const, dependsOn: ["b"] },
      { id: "b", type: "worker" as const, dependsOn: [] },
    ];

    story.given("a graph where a depends on b");
    const sorted = topologicalSort(nodes);

    story.then("b appears before a in sorted order");
    expect(sorted.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("detects a direct cycle (A -> B -> A)", ({ task }) => {
    story.init(task);

    const nodes = [
      { id: "a", type: "worker" as const, dependsOn: ["b"] },
      { id: "b", type: "worker" as const, dependsOn: ["a"] },
    ];

    story.given("a graph with a direct cycle");
    story.then("topologicalSort throws");
    expect(() => topologicalSort(nodes)).toThrow("Circular dependency detected: a -> b -> a");
  });

  it("detects a transitive cycle (A -> B -> C -> A)", ({ task }) => {
    story.init(task);

    const nodes = [
      { id: "a", type: "worker" as const, dependsOn: ["b"] },
      { id: "b", type: "worker" as const, dependsOn: ["c"] },
      { id: "c", type: "worker" as const, dependsOn: ["a"] },
    ];

    story.given("a graph with a transitive cycle");
    story.then("topologicalSort throws");
    expect(() => topologicalSort(nodes)).toThrow("Circular dependency detected");
  });

  it("handles independent nodes", ({ task }) => {
    story.init(task);

    const nodes = [
      { id: "a", type: "worker" as const, dependsOn: [] },
      { id: "b", type: "worker" as const, dependsOn: [] },
    ];

    story.given("nodes with no dependencies");
    const sorted = topologicalSort(nodes);

    story.then("both nodes are included in result");
    expect(sorted).toHaveLength(2);
  });
});

describe("resolveDeployOrder", () => {
  it("uses explicit deployOrder when provided", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api", "apps/worker"],
      deployOrder: ["apps/worker", "apps/api"],
      resources: {},
    };

    story.given("config with explicit deployOrder");
    story.then("returns the explicit order");
    expect(resolveDeployOrder(config)).toEqual(["apps/worker", "apps/api"]);
  });

  it("infers order from service bindings when deployOrder is omitted", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api", "apps/worker"],
      resources: {},
      serviceBindings: {
        "apps/api": { BACKEND: "apps/worker" },
      },
    };

    story.given("config with service bindings but no explicit order");
    const order = resolveDeployOrder(config);

    story.then("worker appears before api (dependee before dependent)");
    expect(order.indexOf("apps/worker")).toBeLessThan(order.indexOf("apps/api"));
  });

  it("handles no service bindings — returns workers in declaration order", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/a", "apps/b", "apps/c"],
      resources: {},
    };

    story.given("workers with no bindings or order specified");
    story.then("returns workers in declaration order");
    expect(resolveDeployOrder(config)).toEqual(["apps/a", "apps/b", "apps/c"]);
  });

  it("throws on cyclic service bindings", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/a", "apps/b"],
      resources: {},
      serviceBindings: {
        "apps/a": { X: "apps/b" },
        "apps/b": { Y: "apps/a" },
      },
    };

    story.given("service bindings forming a cycle");
    story.then("resolveDeployOrder throws");
    expect(() => resolveDeployOrder(config)).toThrow("Circular dependency detected");
  });

  it("throws on unknown service binding target", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {},
      serviceBindings: {
        "apps/api": { BACKEND: "apps/ghost" },
      },
    };

    story.given("service binding pointing to undeclared worker");
    story.then("throws an error");
    expect(() => resolveDeployOrder(config)).toThrow(
      '"apps/api" depends on "apps/ghost" which is not declared',
    );
  });

  it("orders DLQ resource after its source queue", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/router"],
      resources: {
        outbox: { type: "queue", bindings: { "apps/router": { producer: "Q" } } },
        "outbox-dlq": {
          type: "queue",
          bindings: { "apps/router": { deadLetterFor: "outbox" } },
        },
      },
    };

    story.given("a DLQ resource");
    const graph = buildGraph(config);
    const sorted = topologicalSort(graph);
    const ids = sorted.map((n) => n.id);

    story.then("source queue appears before DLQ");
    expect(ids.indexOf("outbox")).toBeLessThan(ids.indexOf("outbox-dlq"));
  });

  it("throws when explicit deployOrder violates service binding dependency", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api", "apps/worker"],
      deployOrder: ["apps/api", "apps/worker"], // wrong: api depends on worker
      resources: {},
      serviceBindings: {
        "apps/api": { BACKEND: "apps/worker" },
      },
    };

    story.given("explicit order that violates dependency");
    story.then("throws an error");
    expect(() => resolveDeployOrder(config)).toThrow(
      '"apps/api" is scheduled before "apps/worker" but depends on it via service binding "BACKEND"',
    );
  });

  it("accepts explicit deployOrder that respects dependencies", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api", "apps/worker"],
      deployOrder: ["apps/worker", "apps/api"], // correct: worker first
      resources: {},
      serviceBindings: {
        "apps/api": { BACKEND: "apps/worker" },
      },
    };

    story.given("explicit order that respects dependencies");
    story.then("returns the explicit order");
    expect(resolveDeployOrder(config)).toEqual(["apps/worker", "apps/api"]);
  });

  it("throws when explicit deployOrder omits a declared worker", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api", "apps/worker"],
      deployOrder: ["apps/api"],
      resources: {},
    };

    story.given("an explicit deployOrder missing one declared worker");
    story.then("resolveDeployOrder rejects the incomplete order");
    expect(() => resolveDeployOrder(config)).toThrow();
  });

  it("throws when explicit deployOrder includes an undeclared worker", ({ task }) => {
    story.init(task);

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      deployOrder: ["apps/api", "apps/ghost"],
      resources: {},
    };

    story.given("an explicit deployOrder containing a worker not declared in config.workers");
    story.then("resolveDeployOrder rejects the unknown worker");
    expect(() => resolveDeployOrder(config)).toThrow();
  });
});
