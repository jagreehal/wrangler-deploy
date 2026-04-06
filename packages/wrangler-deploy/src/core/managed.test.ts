import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { writeManagedBindings } from "./managed.js";
import type { CfStageConfig, StageState } from "../types.js";

const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/batch-workflow"],
  resources: {
    "cache-kv": {
      type: "kv",
      bindings: { "apps/api": "CACHE" },
    },
    "payments-db": {
      type: "d1",
      bindings: { "apps/api": "DB", "apps/batch-workflow": "DB" },
    },
    "payments-hyperdrive": {
      type: "hyperdrive",
      bindings: { "apps/api": "HD" },
    },
    "payment-queue": {
      type: "queue",
      bindings: {
        "apps/api": { producer: "PAYMENT_QUEUE" },
        "apps/batch-workflow": { consumer: true },
      },
    },
  },
  serviceBindings: {
    "apps/api": { BATCH: "apps/batch-workflow" },
  },
};

const state: StageState = {
  stage: "staging",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  resources: {
    "cache-kv": {
      type: "kv",
      desired: { name: "cache-kv-staging" },
      observed: { id: "kv-id-abc", status: "active" },
      source: "managed",
    },
    "payments-db": {
      type: "d1",
      desired: { name: "payments-db-staging" },
      observed: { id: "d1-id-xyz", status: "active" },
      source: "managed",
    },
    "payments-hyperdrive": {
      type: "hyperdrive",
      desired: { name: "payments-hyperdrive-staging" },
      observed: { id: "hd-id-123", status: "active" },
      source: "managed",
    },
    "payment-queue": {
      type: "queue",
      desired: { name: "payment-queue-staging" },
      observed: { id: "q-id-456", status: "active" },
      source: "managed",
    },
  },
  workers: {
    "apps/api": { name: "api-staging", url: "https://api-staging.example.com" },
    "apps/batch-workflow": { name: "batch-workflow-staging" },
  },
  secrets: {},
};

const stateWithMissingId: StageState = {
  ...state,
  resources: {
    ...state.resources,
    "cache-kv": {
      type: "kv",
      desired: { name: "cache-kv-staging" },
      observed: { status: "missing" },
      source: "managed",
    },
  },
};

describe("writeManagedBindings", () => {
  it("generates KV and D1 bindings with correct IDs", ({ task }) => {
    story.init(task);
    story.given("a config with KV, D1, hyperdrive, and queue bindings for apps/api");

    const result = writeManagedBindings("apps/api", config, state);

    story.then("KV bindings include the correct ID");
    expect(result.kv_namespaces).toEqual([{ binding: "CACHE", id: "kv-id-abc" }]);

    story.then("D1 bindings include the database_id and database_name");
    expect(result.d1_databases).toEqual([
      { binding: "DB", database_id: "d1-id-xyz", database_name: "payments-db-staging" },
    ]);

    story.then("Hyperdrive bindings are included");
    expect(result.hyperdrive).toEqual([{ binding: "HD", id: "hd-id-123" }]);

    story.then("Queue producer bindings are included");
    expect(result.queues?.producers).toEqual([
      { binding: "PAYMENT_QUEUE", queue: "payment-queue-staging" },
    ]);

    story.then("Service bindings map target worker to deployed name");
    expect(result.services).toEqual([{ binding: "BATCH", service: "batch-workflow-staging" }]);
  });

  it("skips resources without observed IDs", ({ task }) => {
    story.init(task);
    story.given("a state where cache-kv has no observed ID (missing)");

    const result = writeManagedBindings("apps/api", config, stateWithMissingId);

    story.then("KV bindings are not generated for the missing resource");
    expect(result.kv_namespaces).toBeUndefined();

    story.then("D1 bindings are still generated (has an ID)");
    expect(result.d1_databases).toBeDefined();
  });
});
