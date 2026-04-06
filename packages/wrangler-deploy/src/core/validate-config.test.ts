import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { validateConfig } from "./validate-config.js";
import type { CfStageConfig } from "../types.js";

const validConfig: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/batch-workflow"],
  resources: {
    "cache-kv": {
      type: "kv",
      bindings: { "apps/api": "CACHE" },
    },
    "payment-queue": {
      type: "queue",
      bindings: {
        "apps/api": { producer: "PAYMENT_QUEUE" },
        "apps/batch-workflow": { consumer: true },
      },
    },
    "dlq": {
      type: "queue",
      bindings: { "apps/batch-workflow": { deadLetterFor: "payment-queue" } },
    },
  },
  serviceBindings: {
    "apps/api": { BATCH: "apps/batch-workflow" },
  },
};

describe("validateConfig", () => {
  it("passes for a valid config", ({ task }) => {
    story.init(task);
    story.given("a config where all references are valid and there are no cycles");
    const errors = validateConfig(validConfig);
    story.then("no errors are returned");
    expect(errors).toHaveLength(0);
  });

  it("catches binding to a non-existent worker", ({ task }) => {
    story.init(task);
    story.given("a resource that has a binding for a worker not in the workers list");
    const config: CfStageConfig = {
      ...validConfig,
      resources: {
        ...validConfig.resources,
        "orphan-kv": {
          type: "kv",
          bindings: { "apps/missing-worker": "KV" },
        },
      },
    };
    const errors = validateConfig(config);
    story.then("an error is returned about the unknown worker");
    expect(errors.some((e) => e.includes("apps/missing-worker"))).toBe(true);
  });

  it("catches circular service bindings", ({ task }) => {
    story.init(task);
    story.given("two workers that each bind to the other as a service");
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/a", "apps/b"],
      resources: {},
      serviceBindings: {
        "apps/a": { B: "apps/b" },
        "apps/b": { A: "apps/a" },
      },
    };
    const errors = validateConfig(config);
    story.then("a circular binding error is detected");
    expect(errors.some((e) => e.toLowerCase().includes("circular"))).toBe(true);
  });

  it("catches DLQ referencing a non-existent resource", ({ task }) => {
    story.init(task);
    story.given("a queue resource with a deadLetterFor pointing to a non-existent resource");
    const config: CfStageConfig = {
      ...validConfig,
      resources: {
        "payment-queue": {
          type: "queue",
          bindings: {
            "apps/api": { producer: "PAYMENT_QUEUE" },
            "apps/batch-workflow": { deadLetterFor: "non-existent-queue" },
          },
        },
      },
    };
    const errors = validateConfig(config);
    story.then("an error about the unknown DLQ resource is returned");
    expect(errors.some((e) => e.includes("non-existent-queue"))).toBe(true);
  });

  it("catches service binding to a non-existent worker", ({ task }) => {
    story.init(task);
    story.given("a service binding that targets a worker not in the workers list");
    const config: CfStageConfig = {
      ...validConfig,
      serviceBindings: {
        "apps/api": { MISSING: "apps/does-not-exist" },
      },
    };
    const errors = validateConfig(config);
    story.then("an error about the unknown target worker is returned");
    expect(errors.some((e) => e.includes("apps/does-not-exist"))).toBe(true);
  });

  it("catches DLQ referencing a resource that is not a queue", ({ task }) => {
    story.init(task);
    story.given("a deadLetterFor reference that points at an existing KV resource instead of a queue");
    const config: CfStageConfig = {
      ...validConfig,
      resources: {
        "cache-kv": {
          type: "kv",
          bindings: { "apps/api": "CACHE" },
        },
        "payment-queue": {
          type: "queue",
          bindings: {
            "apps/api": { producer: "PAYMENT_QUEUE" },
          },
        },
        "dlq": {
          type: "queue",
          bindings: { "apps/batch-workflow": { deadLetterFor: "cache-kv" } },
        },
      },
    };
    const errors = validateConfig(config);
    story.then("an error is returned because deadLetterFor must target another queue");
    expect(errors.some((e) => e.includes("deadLetterFor") && e.includes("queue"))).toBe(true);
  });
});
