import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { renderWranglerConfig } from "./render.js";
import type { CfStageConfig, StageState, WranglerConfig } from "../types.js";

const baseApiConfig: WranglerConfig = {
  name: "my-api",
  main: "src/index.ts",
  compatibility_date: "2026-03-18",
  compatibility_flags: ["nodejs_compat"],
  kv_namespaces: [{ binding: "CACHE", id: "placeholder" }],
  queues: {
    producers: [{ queue: "events", binding: "EVENT_QUEUE" }],
  },
  services: [{ binding: "BACKEND", service: "my-backend" }],
  hyperdrive: [
    {
      binding: "DB",
      id: "placeholder-hd",
      localConnectionString: "postgresql://test:test@localhost:5433/mydb",
    },
  ],
};

const baseRouterConfig: WranglerConfig = {
  name: "my-router",
  main: "src/index.ts",
  compatibility_date: "2026-03-18",
  queues: {
    consumers: [
      {
        queue: "events",
        max_batch_size: 10,
        max_retries: 3,
        retry_delay: 5,
        dead_letter_queue: "events-dlq",
      },
    ],
    producers: [{ queue: "events", binding: "EVENT_QUEUE" }],
  },
};

const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/router"],
  deployOrder: ["apps/router", "apps/api"],
  resources: {
    "app-cache": {
      type: "kv",
      bindings: { "apps/api": "CACHE" },
    },
    "events": {
      type: "queue",
      bindings: {
        "apps/api": { producer: "EVENT_QUEUE" },
        "apps/router": { producer: "EVENT_QUEUE", consumer: true },
      },
    },
    "events-dlq": {
      type: "queue",
      bindings: {
        "apps/router": { deadLetterFor: "events" },
      },
    },
    "app-db": {
      type: "hyperdrive",
      bindings: { "apps/api": "DB" },
    },
  },
  serviceBindings: {
    "apps/api": { BACKEND: "apps/router" },
  },
};

const state: StageState = {
  stage: "staging",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  resources: {
    "app-cache": {
      type: "kv",
      desired: { name: "app-cache-staging" },
      observed: { id: "abc123def456", status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
      source: "managed",
    },
    "events": {
      type: "queue",
      desired: { name: "events-staging" },
      observed: { status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
      source: "managed",
    },
    "events-dlq": {
      type: "queue",
      desired: { name: "events-dlq-staging" },
      observed: { status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
      source: "managed",
    },
    "app-db": {
      type: "hyperdrive",
      desired: { name: "app-db-staging" },
      observed: { id: "hd-999-888", status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
      source: "managed",
    },
  },
  workers: {
    "apps/api": { name: "my-api-staging" },
    "apps/router": { name: "my-router-staging" },
  },
  secrets: {},
};

describe("golden: renderWranglerConfig", () => {
  it("renders API worker with correct KV ID, queue name, service binding, and no Hyperdrive placeholder", ({ task }) => {
    story.init(task);

    story.given("an API worker config with KV, queue, service binding, and Hyperdrive");
    story.and("state contains provisioned resource IDs for staging");

    story.when("renderWranglerConfig is called for staging");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", config, state, "staging");

    story.then("the worker name is stage-suffixed");
    expect(rendered.name).toBe("my-api-staging");

    story.and("KV ID is replaced from state");
    expect(rendered.kv_namespaces).toEqual([{ binding: "CACHE", id: "abc123def456" }]);

    story.and("queue name is stage-suffixed");
    expect(rendered.queues?.producers).toEqual([
      { queue: "events-staging", binding: "EVENT_QUEUE" },
    ]);

    story.and("service binding target is stage-suffixed");
    expect(rendered.services).toEqual([
      { binding: "BACKEND", service: "my-router-staging" },
    ]);

    story.and("Hyperdrive ID is replaced and localConnectionString removed");
    expect(rendered.hyperdrive).toEqual([{ binding: "DB", id: "hd-999-888" }]);

    story.and("compatibility flags are preserved");
    expect(rendered.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(rendered.compatibility_date).toBe("2026-03-18");
  });

  it("renders router worker with stage-suffixed queue names and DLQ", ({ task }) => {
    story.init(task);

    story.given("a router worker config with queue consumers, producers, and a DLQ");

    story.when("renderWranglerConfig is called for staging");
    const rendered = renderWranglerConfig(baseRouterConfig, "apps/router", config, state, "staging");

    story.then("the worker name is stage-suffixed");
    expect(rendered.name).toBe("my-router-staging");

    story.and("consumer queue name is stage-suffixed");
    expect(rendered.queues?.consumers?.[0]?.queue).toBe("events-staging");

    story.and("DLQ is stage-suffixed");
    expect(rendered.queues?.consumers?.[0]?.dead_letter_queue).toBe("events-dlq-staging");

    story.and("consumer settings are preserved from base config");
    expect(rendered.queues?.consumers?.[0]?.max_batch_size).toBe(10);
    expect(rendered.queues?.consumers?.[0]?.max_retries).toBe(3);
    expect(rendered.queues?.consumers?.[0]?.retry_delay).toBe(5);

    story.and("producer queue name is also stage-suffixed");
    expect(rendered.queues?.producers).toEqual([
      { queue: "events-staging", binding: "EVENT_QUEUE" },
    ]);
  });

  it("renders for pr-123 stage with different suffixes", ({ task }) => {
    story.init(task);

    story.given("a PR stage with pr-123 resource IDs and worker names");
    const prState: StageState = {
      ...state,
      stage: "pr-123",
      resources: {
        "app-cache": {
          type: "kv",
          desired: { name: "app-cache-pr-123" },
          observed: { id: "pr-kv-id", status: "active" as const, lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
        "events": {
          type: "queue",
          desired: { name: "events-pr-123" },
          observed: { status: "active" as const, lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
        "events-dlq": {
          type: "queue",
          desired: { name: "events-dlq-pr-123" },
          observed: { status: "active" as const, lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
      },
      workers: {
        "apps/api": { name: "my-api-pr-123" },
        "apps/router": { name: "my-router-pr-123" },
      },
    };

    story.when("renderWranglerConfig is called for pr-123");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", config, prState, "pr-123");

    story.then("all names and IDs use the pr-123 suffix");
    expect(rendered.name).toBe("my-api-pr-123");
    expect(rendered.kv_namespaces).toEqual([{ binding: "CACHE", id: "pr-kv-id" }]);
    expect(rendered.queues?.producers?.[0]?.queue).toBe("events-pr-123");
    expect(rendered.services).toEqual([
      { binding: "BACKEND", service: "my-router-pr-123" },
    ]);
  });

  it("strips placeholder KV IDs from output", ({ task }) => {
    story.init(task);

    story.given("a KV resource in state with no real ID");
    const stateNoKv: StageState = {
      ...state,
      resources: {
        ...state.resources,
        "app-cache": {
          type: "kv",
          desired: { name: "app-cache-staging" },
          observed: { status: "active" as const, lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
      },
    };

    story.when("renderWranglerConfig is called");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", config, stateNoKv, "staging");

    story.then("the KV namespace is excluded from the rendered config");
    expect(rendered.kv_namespaces).toBeUndefined();
  });

  it("renders routes with stage-specific patterns", ({ task }) => {
    story.init(task);

    story.given("a config with route patterns containing a {stage} placeholder");
    const configWithRoutes = {
      ...config,
      routes: {
        "apps/api": {
          pattern: "api-{stage}.example.com/*",
          zone: "example.com",
        },
      },
    };

    story.when("renderWranglerConfig is called for staging");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", configWithRoutes, state, "staging");

    story.then("the route pattern has {stage} replaced with the stage name");
    expect(rendered.routes).toEqual([
      { pattern: "api-staging.example.com/*", zone_name: "example.com" },
    ]);
  });

  it("renders routes for PR stages", ({ task }) => {
    story.init(task);

    story.given("a config with route patterns containing a {stage} placeholder");
    const configWithRoutes = {
      ...config,
      routes: {
        "apps/api": {
          pattern: "api-{stage}.example.com/*",
          zone: "example.com",
        },
      },
    };

    story.and("a PR stage with pr-123 worker names");
    const prState = {
      ...state,
      stage: "pr-123",
      workers: {
        "apps/api": { name: "my-api-pr-123" },
        "apps/router": { name: "my-router-pr-123" },
      },
    };

    story.when("renderWranglerConfig is called for pr-123");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", configWithRoutes, prState, "pr-123");

    story.then("the route pattern uses the PR stage name");
    expect(rendered.routes).toEqual([
      { pattern: "api-pr-123.example.com/*", zone_name: "example.com" },
    ]);
  });

  it("strips placeholder Hyperdrive IDs from output", ({ task }) => {
    story.init(task);

    story.given("a Hyperdrive resource in state with no real ID");
    const stateNoHd: StageState = {
      ...state,
      resources: {
        ...state.resources,
        "app-db": {
          type: "hyperdrive",
          desired: { name: "app-db-staging" },
          observed: { status: "active" as const, lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
      },
    };

    story.when("renderWranglerConfig is called");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", config, stateNoHd, "staging");

    story.then("the Hyperdrive binding is excluded from the rendered config");
    expect(rendered.hyperdrive).toBeUndefined();
  });

  it("only rewrites the matching queue consumer when a worker consumes multiple queues", ({ task }) => {
    story.init(task);

    story.given("a worker config with two independent queue consumers");
    const baseMultiConsumerConfig: WranglerConfig = {
      name: "multi-consumer",
      main: "src/index.ts",
      queues: {
        consumers: [
          { queue: "events", max_batch_size: 10 },
          { queue: "audit", max_batch_size: 5 },
        ],
      },
    };

    const multiConfig: CfStageConfig = {
      version: 1,
      workers: ["apps/router"],
      resources: {
        events: {
          type: "queue",
          bindings: {
            "apps/router": { consumer: true },
          },
        },
        audit: {
          type: "queue",
          bindings: {},
        },
      },
    };

    const multiState: StageState = {
      ...state,
      resources: {
        events: {
          type: "queue",
          desired: { name: "events-staging" },
          observed: { status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
        audit: {
          type: "queue",
          desired: { name: "audit-staging" },
          observed: { status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
      },
      workers: {
        "apps/router": { name: "multi-consumer-staging" },
      },
    };

    story.when("renderWranglerConfig is called for the consumer worker");
    const rendered = renderWranglerConfig(
      baseMultiConsumerConfig,
      "apps/router",
      multiConfig,
      multiState,
      "staging",
    );

    story.then("only the bound consumer queue is stage-suffixed");
    expect(rendered.queues?.consumers).toEqual([
      { queue: "events-staging", max_batch_size: 10 },
      { queue: "audit", max_batch_size: 5 },
    ]);
  });

  it("uses the queue name from state rather than recomputing it from the logical name", ({ task }) => {
    story.init(task);

    story.given("a queue resource whose actual staged name differs from resourceName(logicalName, stage)");
    const customState: StageState = {
      ...state,
      resources: {
        ...state.resources,
        events: {
          type: "queue",
          desired: { name: "custom-events-staging" },
          observed: { status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
          source: "managed",
        },
      },
    };

    story.when("renderWranglerConfig is called for a producer bound to that queue");
    const rendered = renderWranglerConfig(baseApiConfig, "apps/api", config, customState, "staging");

    story.then("the rendered producer should target the actual queue name from state");
    expect(rendered.queues?.producers).toContainEqual({
      queue: "custom-events-staging",
      binding: "EVENT_QUEUE",
    });
  });
});
