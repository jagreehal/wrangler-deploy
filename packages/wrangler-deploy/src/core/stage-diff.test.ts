import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { diffStages } from "./stage-diff.js";
import type { StageState } from "../types.js";

const stageA: StageState = {
  stage: "staging",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  resources: {
    "payments-db": {
      type: "d1",
      lifecycleStatus: "created",
      props: { type: "d1", name: "staging-payments-db", bindings: {} },
      output: { id: "db-staging-001", name: "staging-payments-db" },
      source: "managed",
    },
    "cache-kv": {
      type: "kv",
      lifecycleStatus: "created",
      props: { type: "kv", name: "staging-cache-kv", bindings: {} },
      output: { id: "kv-staging-001", title: "staging-cache-kv" },
      source: "managed",
    },
    "staging-only-kv": {
      type: "kv",
      lifecycleStatus: "created",
      props: { type: "kv", name: "staging-only-kv", bindings: {} },
      output: { id: "kv-staging-extra", title: "staging-only-kv" },
      source: "managed",
    },
  },
  workers: {
    "apps/api": { name: "staging-api", deployed: true },
    "apps/batch-workflow": { name: "staging-batch", deployed: true },
    "apps/staging-only": { name: "staging-only-worker", deployed: true },
  },
  secrets: {
    "apps/api": { API_KEY: "set", DB_PASSWORD: "set" },
    "apps/batch-workflow": { WORKER_SECRET: "set" },
  },
};

const stageB: StageState = {
  stage: "production",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  resources: {
    "payments-db": {
      type: "d1",
      lifecycleStatus: "created",
      props: { type: "d1", name: "prod-payments-db", bindings: {} },
      output: { id: "db-prod-001", name: "prod-payments-db" },
      source: "managed",
    },
    "cache-kv": {
      type: "kv",
      lifecycleStatus: "created",
      props: { type: "kv", name: "prod-cache-kv", bindings: {} },
      output: { id: "kv-prod-001", title: "prod-cache-kv" },
      source: "managed",
    },
  },
  workers: {
    "apps/api": { name: "prod-api", deployed: true },
    "apps/batch-workflow": { name: "prod-batch", deployed: true },
  },
  secrets: {
    "apps/api": { API_KEY: "set", DB_PASSWORD: "missing" },
    "apps/batch-workflow": { WORKER_SECRET: "set" },
  },
};

describe("diffStages", () => {
  it("sets stageA and stageB names on result", ({ task }) => {
    story.init(task);
    story.given("two stage states named staging and production");
    const result = diffStages(stageA, stageB);

    story.then("result.stageA is staging and result.stageB is production");
    expect(result.stageA).toBe("staging");
    expect(result.stageB).toBe("production");
  });

  it("classifies shared resources with same type as same", ({ task }) => {
    story.init(task);
    story.given("payments-db exists in both stages with same type d1");
    const result = diffStages(stageA, stageB);

    story.then("payments-db has status same");
    const resource = result.resources.find((r) => r.name === "payments-db");
    expect(resource).toBeDefined();
    expect(resource?.status).toBe("same");
    expect(resource?.type).toBe("d1");
  });

  it("classifies a resource only in A as only-in-a", ({ task }) => {
    story.init(task);
    story.given("staging-only-kv exists only in stageA");
    const result = diffStages(stageA, stageB);

    story.then("staging-only-kv has status only-in-a");
    const resource = result.resources.find((r) => r.name === "staging-only-kv");
    expect(resource).toBeDefined();
    expect(resource?.status).toBe("only-in-a");
    expect(resource?.idA).toBe("kv-staging-extra");
    expect(resource?.idB).toBeUndefined();
  });

  it("classifies a resource only in B as only-in-b", ({ task }) => {
    story.init(task);
    story.given("a stageB with a resource not in stageA");
    const stateWithExtraB: StageState = {
      ...stageB,
      resources: {
        ...stageB.resources,
        "prod-only-queue": {
          type: "queue",
          lifecycleStatus: "created",
          props: { type: "queue", name: "prod-only-queue", bindings: {} },
          output: { id: "q-prod-extra", name: "prod-only-queue" },
          source: "managed",
        },
      },
    };
    const result = diffStages(stageA, stateWithExtraB);

    story.then("prod-only-queue has status only-in-b");
    const resource = result.resources.find((r) => r.name === "prod-only-queue");
    expect(resource).toBeDefined();
    expect(resource?.status).toBe("only-in-b");
    expect(resource?.idA).toBeUndefined();
    expect(resource?.idB).toBe("q-prod-extra");
  });

  it("classifies a resource with different type as different", ({ task }) => {
    story.init(task);
    story.given("cache-kv has type kv in A but type d1 in B");
    const stateWithDifferentType: StageState = {
      ...stageB,
      resources: {
        ...stageB.resources,
        "cache-kv": {
          type: "d1",
          lifecycleStatus: "created",
          props: { type: "d1", name: "prod-cache-kv-d1", bindings: {} },
          output: { id: "d1-prod-001", name: "prod-cache-kv-d1" },
          source: "managed",
        },
      },
    };
    const result = diffStages(stageA, stateWithDifferentType);

    story.then("cache-kv has status different");
    const resource = result.resources.find((r) => r.name === "cache-kv");
    expect(resource).toBeDefined();
    expect(resource?.status).toBe("different");
  });

  it("classifies shared workers as same", ({ task }) => {
    story.init(task);
    story.given("apps/api exists in both stages");
    const result = diffStages(stageA, stageB);

    story.then("apps/api worker has status same");
    const worker = result.workers.find((w) => w.path === "apps/api");
    expect(worker).toBeDefined();
    expect(worker?.status).toBe("same");
    expect(worker?.nameA).toBe("staging-api");
    expect(worker?.nameB).toBe("prod-api");
  });

  it("classifies a worker only in A as only-in-a", ({ task }) => {
    story.init(task);
    story.given("apps/staging-only exists only in stageA");
    const result = diffStages(stageA, stageB);

    story.then("apps/staging-only has status only-in-a");
    const worker = result.workers.find((w) => w.path === "apps/staging-only");
    expect(worker).toBeDefined();
    expect(worker?.status).toBe("only-in-a");
    expect(worker?.nameA).toBe("staging-only-worker");
    expect(worker?.nameB).toBeUndefined();
  });

  it("reports secret differences — set in A, missing in B", ({ task }) => {
    story.init(task);
    story.given("DB_PASSWORD is set in staging but missing in production");
    const result = diffStages(stageA, stageB);

    story.then("a SecretDiff exists for apps/api DB_PASSWORD with inA=set and inB=missing");
    const secretDiff = result.secrets.find(
      (s) => s.worker === "apps/api" && s.name === "DB_PASSWORD",
    );
    expect(secretDiff).toBeDefined();
    expect(secretDiff?.inA).toBe("set");
    expect(secretDiff?.inB).toBe("missing");
  });

  it("does not report secrets that are identical in both stages", ({ task }) => {
    story.init(task);
    story.given("API_KEY is set in both staging and production");
    const result = diffStages(stageA, stageB);

    story.then("no SecretDiff for apps/api API_KEY");
    const secretDiff = result.secrets.find(
      (s) => s.worker === "apps/api" && s.name === "API_KEY",
    );
    expect(secretDiff).toBeUndefined();
  });

  it("reports a secret absent in A but set in B", ({ task }) => {
    story.init(task);
    story.given("stageB has a secret not present in stageA's worker at all");
    const stateWithExtraSecret: StageState = {
      ...stageB,
      secrets: {
        ...stageB.secrets,
        "apps/api": { ...stageB.secrets["apps/api"], NEW_SECRET: "set" },
      },
    };
    const result = diffStages(stageA, stateWithExtraSecret);

    story.then("NEW_SECRET for apps/api has inA=absent and inB=set");
    const secretDiff = result.secrets.find(
      (s) => s.worker === "apps/api" && s.name === "NEW_SECRET",
    );
    expect(secretDiff).toBeDefined();
    expect(secretDiff?.inA).toBe("absent");
    expect(secretDiff?.inB).toBe("set");
  });
});
