import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import type { CfStageConfig, StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import type { ApplyDeps } from "./apply.js";
import { apply, plan } from "./apply.js";

function createMockProvider(state: StageState | null = null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

/** Stub deps that bypass filesystem and wrangler CLI calls */
function stubDeps(overrides: Partial<ApplyDeps> & { config: CfStageConfig; state: StateProvider }): ApplyDeps {
  return {
    rootDir: "/repo",
    wrangler: { run: vi.fn().mockReturnValue(JSON.stringify({ id: "generated-id" })) },
    createD1: vi.fn().mockReturnValue({ id: "d1-id", name: "payments-db-staging", version: "v1" }),
    createR2: vi.fn().mockReturnValue({ name: "uploads-staging" }),
    createVectorize: vi.fn().mockReturnValue({ id: "vec-id", name: "idx-staging" }),
    readConfig: vi.fn().mockReturnValue({ name: "api", main: "src/index.ts" }),
    renderConfig: vi.fn().mockImplementation((baseConfig) => baseConfig),
    writeConfigs: vi.fn(),
    ...overrides,
  };
}

const kvAndD1Config: CfStageConfig = {
  version: 1,
  workers: ["apps/api"],
  resources: {
    "cache-kv": { type: "kv", bindings: { "apps/api": "CACHE" } },
    "payments-db": { type: "d1", bindings: { "apps/api": "DB" } },
  },
};

// ============================================================================
// plan()
// ============================================================================

describe("plan", () => {
  it("reports all resources as create when no state exists", async ({ task }) => {
    story.init(task);

    story.given("a config with KV and D1 resources and no existing state");
    const provider = createMockProvider(null);

    story.when("plan is computed");
    const result = await plan(
      { stage: "staging" },
      { rootDir: "/repo", config: kvAndD1Config, state: provider },
    );

    story.then("all resources should be marked for creation");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ resource: "cache-kv", action: "create", name: "cache-kv-staging" });
    expect(result.items[1]).toMatchObject({ resource: "payments-db", action: "create", name: "payments-db-staging" });
  });

  it("reports resources as in-sync when state has them active", async ({ task }) => {
    story.init(task);

    story.given("state with both resources created");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          output: { id: "kv-123", title: "cache-kv-staging" },
          source: "managed",
        },
        "payments-db": {
          type: "d1",
          lifecycleStatus: "created",
          props: { type: "d1", name: "payments-db-staging", bindings: {} },
          output: { id: "db-123", name: "payments-db-staging", version: "v1" },
          source: "managed",
        },
      },
      workers: {}, secrets: {},
    };
    const provider = createMockProvider(state);

    story.when("plan is computed");
    const result = await plan(
      { stage: "staging" },
      { rootDir: "/repo", config: kvAndD1Config, state: provider },
    );

    story.then("all resources should be in-sync");
    expect(result.items.every((i) => i.action === "in-sync")).toBe(true);
  });

  it("uses the resource name from state for existing resources instead of recomputing it", async ({ task }) => {
    story.init(task);

    story.given("state with an active resource whose live name differs from resourceName(logicalName, stage)");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "custom-cache-staging", bindings: {} },
          output: { id: "kv-123", title: "custom-cache-staging" },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
    };
    const provider = createMockProvider(state);
    const config: CfStageConfig = {
      version: 1,
      workers: [],
      resources: { "cache-kv": { type: "kv", bindings: {} } },
    };

    story.when("plan is computed");
    const result = await plan({ stage: "staging" }, { rootDir: "/repo", config, state: provider });

    story.then("the existing resource should be reported using the authoritative state name");
    expect(result.items[0]?.name).toBe("custom-cache-staging");
  });

  it("detects orphaned resources in state but not in config", async ({ task }) => {
    story.init(task);

    story.given("state has a resource removed from config");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          output: { id: "kv-123", title: "cache-kv-staging" },
          source: "managed",
        },
        "old-queue": {
          type: "queue",
          lifecycleStatus: "created",
          props: { type: "queue", name: "old-queue-staging", bindings: {} },
          output: { name: "old-queue-staging" },
          source: "managed",
        },
      },
      workers: {}, secrets: {},
    };
    const provider = createMockProvider(state);
    const config: CfStageConfig = {
      version: 1, workers: ["apps/api"],
      resources: { "cache-kv": { type: "kv", bindings: { "apps/api": "CACHE" } } },
    };

    story.when("plan is computed");
    const result = await plan({ stage: "staging" }, { rootDir: "/repo", config, state: provider });

    story.then("the removed resource should be orphaned");
    const orphan = result.items.find((i) => i.resource === "old-queue");
    expect(orphan?.action).toBe("orphaned");
    expect(orphan?.details).toContain("removed from manifest");
  });

  it("reports drifted resources from state", async ({ task }) => {
    story.init(task);

    story.given("state has a resource marked as drifted");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "drifted",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          output: { id: "kv-123", title: "cache-kv-staging" },
          source: "managed",
        },
      },
      workers: {}, secrets: {},
    };
    const provider = createMockProvider(state);
    const config: CfStageConfig = {
      version: 1, workers: [],
      resources: { "cache-kv": { type: "kv", bindings: {} } },
    };

    story.when("plan is computed");
    const result = await plan({ stage: "staging" }, { rootDir: "/repo", config, state: provider });

    story.then("the resource should be reported as drifted");
    expect(result.items[0]?.action).toBe("drifted");
  });

  it("treats missing resources in state as orphaned in the plan output", async ({ task }) => {
    story.init(task);

    story.given("state has a manifest resource marked as missing");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "missing",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
    };
    const provider = createMockProvider(state);
    const config: CfStageConfig = {
      version: 1,
      workers: [],
      resources: { "cache-kv": { type: "kv", bindings: {} } },
    };

    story.when("plan is computed");
    const result = await plan({ stage: "staging" }, { rootDir: "/repo", config, state: provider });

    story.then("the item should use a valid plan action rather than raw 'missing'");
    expect(result.items[0]?.action).toBe("orphaned");
  });
});

// ============================================================================
// apply()
// ============================================================================

describe("apply", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates resources and writes state after each one", async ({ task }) => {
    story.init(task);

    story.given("a config with KV and D1 resources and no existing state");
    const provider = createMockProvider(null);
    const deps = stubDeps({ config: kvAndD1Config, state: provider });

    story.when("apply is called");
    const result = await apply({ stage: "staging" }, deps);

    story.then("state should contain both resources as created");
    const kvState = result.resources["cache-kv"];
    const dbState = result.resources["payments-db"];
    expect(kvState).toBeDefined();
    expect(kvState!.lifecycleStatus).toBe("created");
    expect(kvState!.props.name).toBe("cache-kv-staging");
    expect(dbState).toBeDefined();
    expect(dbState!.lifecycleStatus).toBe("created");
    expect(result.summary.resources.map((resource) => resource.logicalName)).toEqual(
      expect.arrayContaining(["cache-kv", "payments-db"]),
    );

    story.and("state should be written twice per resource (creating + created) plus once for workers");
    // 2 resources × 2 writes (creating + created) + 1 worker write = 5
    expect(provider.write).toHaveBeenCalledTimes(5);
  });

  it("skips resources already active in state", async ({ task }) => {
    story.init(task);

    story.given("state already has the KV resource created");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          output: { id: "kv-123", title: "cache-kv-staging" },
          source: "managed",
        },
      },
      workers: {}, secrets: {},
    };
    const provider = createMockProvider(state);
    const deps = stubDeps({ config: kvAndD1Config, state: provider });

    story.when("apply is called");
    await apply({ stage: "staging" }, deps);

    story.then("KV should not be recreated, D1 should be created");
    const wranglerCalls = (deps.wrangler.run as ReturnType<typeof vi.fn>).mock.calls;
    const kvCreate = wranglerCalls.find((c: unknown[]) => (c[0] as string[]).some((a: string) => a === "kv"));
    expect(kvCreate).toBeUndefined();
    expect(deps.createD1).toHaveBeenCalledWith("payments-db-staging", "/repo");
  });

  it("throws on resource creation failure and preserves partial state", async ({ task }) => {
    story.init(task);

    story.given("D1 creation fails");
    const provider = createMockProvider(null);
    const deps = stubDeps({
      config: kvAndD1Config,
      state: provider,
      createD1: vi.fn().mockImplementation(() => { throw new Error("d1 create failed"); }),
    });

    story.when("apply is called");
    await expect(apply({ stage: "staging" }, deps)).rejects.toThrow("d1 create failed");

    story.then("the KV resource should still be persisted in state as created");
    const writeCalls = (provider.write as ReturnType<typeof vi.fn>).mock.calls;
    const writeWithKvCreated = writeCalls.find((args: unknown[]) => {
      const s = args[1] as StageState;
      return s.resources["cache-kv"]?.lifecycleStatus === "created";
    });
    expect(writeWithKvCreated).toBeDefined();
  });

  it("removes workers from state that are no longer declared in the manifest", async ({ task }) => {
    story.init(task);

    story.given("existing state containing a worker removed from config.workers");
    const existingState: StageState = {
      stage: "staging",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      resources: {},
      workers: {
        "apps/api": { name: "api-staging" },
        "apps/old-worker": { name: "old-worker-staging" },
      },
      secrets: {},
    };
    const provider = createMockProvider(existingState);
    const config: CfStageConfig = { version: 1, workers: ["apps/api"], resources: {} };
    const deps = stubDeps({ config, state: provider });

    story.when("apply is run");
    const nextState = await apply({ stage: "staging" }, deps);

    story.then("the stale worker should be removed from persisted state");
    expect(nextState.workers).toEqual({ "apps/api": expect.objectContaining({ name: "api-staging" }) });
    expect(nextState.workers["apps/old-worker"]).toBeUndefined();
  });

  it("records worker names with stage suffix", async ({ task }) => {
    story.init(task);

    story.given("a config with one worker");
    const provider = createMockProvider(null);
    const deps = stubDeps({
      config: { version: 1, workers: ["apps/api"], resources: {} },
      state: provider,
      readConfig: vi.fn().mockReturnValue({ name: "payment-api", main: "src/index.ts" }),
    });

    story.when("apply is called");
    const result = await apply({ stage: "pr-42" }, deps);

    story.then("the worker name should be stage-suffixed");
    expect(result.workers["apps/api"]!.name).toBe("payment-api-pr-42");
  });

  it("writes lifecycleStatus 'creating' before calling the provider and 'created' after", async ({ task }) => {
    story.init(task);

    story.given("a config with a KV resource and no existing state");
    const writeOrder: string[] = [];
    const provider: StateProvider = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockImplementation(async (_stage: string, st: StageState) => {
        const kvState = st.resources["cache-kv"];
        if (kvState) writeOrder.push(kvState.lifecycleStatus);
      }),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    };
    const singleKvConfig: CfStageConfig = {
      version: 1, workers: [], resources: { "cache-kv": { type: "kv", bindings: {} } },
    };

    story.when("apply is called");
    await apply({ stage: "staging" }, stubDeps({ config: singleKvConfig, state: provider }));

    story.then("state was written with 'creating' before the provider call and 'created' after");
    expect(writeOrder).toContain("creating");
    expect(writeOrder).toContain("created");
    expect(writeOrder.indexOf("creating")).toBeLessThan(writeOrder.indexOf("created"));
  });

  it("skips resources already 'created' and retries resources stuck in 'creating' (crash recovery)", async ({ task }) => {
    story.init(task);

    story.given("state with cache-kv already 'created' and payments-db stuck in 'creating'");
    const existingState: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          output: { id: "kv-123", title: "cache-kv-staging" },
          source: "managed",
        },
        "payments-db": {
          type: "d1",
          lifecycleStatus: "creating",
          props: { type: "d1", name: "payments-db-staging", bindings: {} },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
    };
    const provider = createMockProvider(existingState);
    const createD1 = vi.fn().mockReturnValue({ id: "new-db-id", name: "payments-db-staging", version: "v1" });

    story.when("apply is called (resume after crash)");
    const deps = stubDeps({ config: kvAndD1Config, state: provider, createD1 });
    await apply({ stage: "staging" }, deps);

    story.then("createD1 was called once (retried) but KV wrangler was NOT called");
    expect(createD1).toHaveBeenCalledTimes(1);
    const wranglerCalls = (deps.wrangler.run as ReturnType<typeof vi.fn>).mock.calls;
    const kvCreate = wranglerCalls.find((c: unknown[]) => (c[0] as string[]).some((a: string) => a === "kv"));
    expect(kvCreate).toBeUndefined();
  });
});
