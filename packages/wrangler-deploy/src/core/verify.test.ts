import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { verify, verifyLocal } from "./verify.js";
import type { CfStageConfig, StageState } from "../types.js";
import type { StateProvider } from "./state.js";

function createMockProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

const mockConfig: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/worker"],
  deployOrder: ["apps/worker", "apps/api"],
  resources: {
    "cache-kv": { type: "kv", bindings: { "apps/api": "CACHE" } },
  },
  serviceBindings: {
    "apps/api": { BACKEND: "apps/worker" },
  },
  secrets: {
    "apps/api": ["API_KEY"],
  },
  verifyLocal: {
    checks: [
      {
        type: "worker",
        worker: "apps/api",
        path: "/health",
        expectStatus: 200,
        expectBodyIncludes: ["ok"],
      },
      {
        type: "queue",
        queue: "jobs",
        payload: '{"type":"job.created"}',
        expectStatus: 200,
        expectBodyIncludes: ["queued"],
      },
      {
        type: "cron",
        worker: "apps/worker",
        expectStatus: 200,
        expectBodyIncludes: ["ok"],
      },
      {
        type: "d1",
        database: "payments-db",
        sql: "SELECT 1 AS ok",
        expectTextIncludes: ['"ok": 1'],
      },
    ],
  },
  dev: {
    d1: {
      "payments-db": {
        worker: "apps/api",
      },
    },
  },
};

const mockState: StageState = {
  stage: "staging",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  resources: {
    "cache-kv": {
      type: "kv",
      lifecycleStatus: "created",
      props: { type: "kv", name: "cache-kv-staging", bindings: {} },
      output: { id: "abc123", title: "cache-kv-staging" },
      source: "managed",
    },
  },
  workers: {
    "apps/api": { name: "api-staging" },
    "apps/worker": { name: "worker-staging" },
  },
  secrets: {
    "apps/api": { API_KEY: "set" },
  },
};

describe("verify", () => {
  it("passes when everything is correct", async ({ task }) => {
    story.init(task);

    story.given("valid state with all resources and secrets");
    const provider = createMockProvider(mockState);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification passes");
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when state is missing", async ({ task }) => {
    story.init(task);

    story.given("no state exists");
    const provider = createMockProvider(null);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification fails with state check");
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.name).toBe("State file exists");
    expect(result.checks[0]?.passed).toBe(false);
  });

  it("fails when a secret is missing", async ({ task }) => {
    story.init(task);

    story.given("state with a missing secret");
    const stateWithMissingSecret = {
      ...mockState,
      secrets: { "apps/api": { API_KEY: "missing" as const } },
    };
    const provider = createMockProvider(stateWithMissingSecret);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification fails on secret check");
    expect(result.passed).toBe(false);
    const secretCheck = result.checks.find((c) => c.name.includes("API_KEY"));
    expect(secretCheck?.passed).toBe(false);
  });

  it("fails when service binding target is missing from state", async ({ task }) => {
    story.init(task);

    story.given("state missing worker referenced in service binding");
    const stateWithMissingWorker = {
      ...mockState,
      workers: { "apps/api": { name: "api-staging" } },
    };
    const provider = createMockProvider(stateWithMissingWorker);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification fails on service binding check");
    expect(result.passed).toBe(false);
    const bindingCheck = result.checks.find((c) => c.name.includes("Service binding"));
    expect(bindingCheck?.passed).toBe(false);
  });

  it("fails when state still contains workers removed from the manifest", async ({ task }) => {
    story.init(task);

    story.given("state containing an extra worker not declared in config.workers");
    const stateWithOrphanedWorker: StageState = {
      ...mockState,
      workers: {
        ...mockState.workers,
        "apps/old-worker": { name: "old-worker-staging" },
      },
    };
    const provider = createMockProvider(stateWithOrphanedWorker);

    story.when("verification runs");
    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification should fail because state contains undeclared workers");
    expect(result.passed).toBe(false);
    const workerCheck = result.checks.find((c) => c.name.includes("Undeclared worker in state"));
    expect(workerCheck?.passed).toBe(false);
  });
});

describe("verifyLocal", () => {
  it("passes when all local runtime checks succeed", async ({ task }) => {
    story.init(task);

    story.given("a local verification config with worker, queue, cron, and d1 checks");
    const config: CfStageConfig = {
      version: 1,
      workers: ["workers/api", "workers/batch-workflow"],
      resources: {
        "payment-outbox": {
          type: "queue",
          bindings: {
            "workers/api": { producer: "OUTBOX_QUEUE" },
          },
        },
        "payments-db": {
          type: "d1",
          bindings: {
            "workers/api": "DB",
          },
        },
      },
      verifyLocal: {
        checks: [
          {
            type: "worker",
            worker: "workers/api",
            path: "/health",
            expectStatus: 200,
            expectBodyIncludes: ["ok"],
          },
          {
            type: "queue",
            queue: "payment-outbox",
            payload: '{"type":"job.created"}',
            expectStatus: 200,
            expectBodyIncludes: ["queued"],
          },
          {
            type: "cron",
            worker: "workers/batch-workflow",
            expectStatus: 200,
            expectBodyIncludes: ["ok"],
          },
          {
            type: "d1",
            database: "payments-db",
            sql: "SELECT 1 AS ok",
            expectTextIncludes: ['"ok": 1'],
          },
        ],
      },
      dev: {
        queues: {
          "payment-outbox": {
            worker: "workers/api",
            path: "/__wd/queues/payment-outbox",
          },
        },
        d1: {
          "payments-db": {
            worker: "workers/api",
          },
        },
      },
    };

    const wrangler = {
      run: vi.fn().mockReturnValue('{\n  "ok": 1\n}'),
    };

    const result = await verifyLocal({
      rootDir: "/repo",
      config,
      wrangler,
      callWorkerFn: vi.fn().mockResolvedValue({
        target: { workerPath: "workers/api", port: 8787, path: "/health", url: "http://127.0.0.1:8787/health" },
        method: "GET",
        status: 200,
        ok: true,
        body: '{"ok":true}',
        headers: {},
      }),
      sendQueueMessageFn: vi.fn().mockResolvedValue({
        target: { queue: "payment-outbox", workerPath: "workers/api", port: 8787, path: "/__wd/queues/payment-outbox", url: "http://127.0.0.1:8787/__wd/queues/payment-outbox" },
        status: 200,
        ok: true,
        body: '{"queued":true}',
      }),
      triggerCronFn: vi.fn().mockResolvedValue({
        url: "http://127.0.0.1:8788/cdn-cgi/handler/scheduled",
        status: 200,
        ok: true,
        body: "ok",
      }),
      resolvePlannedWorkerPortFn: vi.fn().mockResolvedValue(8788),
      executeLocalD1Fn: vi.fn().mockReturnValue({
        target: {
          database: "payments-db",
          workerPath: "workers/api",
          binding: "DB",
          cwd: "/repo/workers/api",
          wranglerArgs: ["d1", "execute", "payments-db", "--local"],
        },
        output: '{\n  "ok": 1\n}',
      }),
    });

    story.then("all local checks pass");
    expect(result.passed).toBe(true);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("passes when local verification checks use shared fixtures", async ({ task }) => {
    story.init(task);

    story.given("a local verification config that references worker, queue, and d1 fixtures");
    const config: CfStageConfig = {
      version: 1,
      workers: ["workers/api", "workers/batch-workflow"],
      resources: {
        "payment-outbox": {
          type: "queue",
          bindings: {
            "workers/api": { producer: "OUTBOX_QUEUE" },
          },
        },
        "payments-db": {
          type: "d1",
          bindings: {
            "workers/api": "DB",
          },
        },
      },
      fixtures: {
        "health-check": {
          type: "worker",
          worker: "workers/api",
          path: "/health",
          method: "GET",
        },
        "job-created": {
          type: "queue",
          queue: "payment-outbox",
          payload: '{"type":"job.created"}',
          worker: "workers/api",
        },
        "assert-ok": {
          type: "d1",
          database: "payments-db",
          sql: "SELECT 1 AS ok",
          worker: "workers/api",
        },
      },
      verifyLocal: {
        checks: [
          {
            type: "worker",
            worker: "workers/api",
            fixture: "health-check",
            expectStatus: 200,
            expectBodyIncludes: ["ok"],
          },
          {
            type: "queue",
            queue: "payment-outbox",
            fixture: "job-created",
            expectStatus: 200,
            expectBodyIncludes: ["queued"],
          },
          {
            type: "d1",
            database: "payments-db",
            fixture: "assert-ok",
            expectTextIncludes: ['"ok": 1'],
          },
        ],
      },
      dev: {
        d1: {
          "payments-db": {
            worker: "workers/api",
          },
        },
      },
    };

    const callWorkerFn = vi.fn().mockResolvedValue({
      target: { workerPath: "workers/api", port: 8787, path: "/health", url: "http://127.0.0.1:8787/health" },
      method: "GET",
      status: 200,
      ok: true,
      body: '{"ok":true}',
      headers: {},
    });
    const sendQueueMessageFn = vi.fn().mockResolvedValue({
      target: { queue: "payment-outbox", workerPath: "workers/api", port: 8787, path: "/__wd/queues/payment-outbox", url: "http://127.0.0.1:8787/__wd/queues/payment-outbox" },
      status: 200,
      ok: true,
      body: '{"queued":true}',
    });
    const executeLocalD1Fn = vi.fn().mockReturnValue({
      target: {
        database: "payments-db",
        workerPath: "workers/api",
        binding: "DB",
        cwd: "/repo/workers/api",
        wranglerArgs: ["d1", "execute", "payments-db", "--local"],
      },
      output: '{\n  "ok": 1\n}',
    });

    const result = await verifyLocal({
      rootDir: "/repo",
      config,
      callWorkerFn,
      sendQueueMessageFn,
      triggerCronFn: vi.fn(),
      resolvePlannedWorkerPortFn: vi.fn(),
      executeLocalD1Fn,
    });

    story.then("the fixtures are resolved into concrete local runtime calls");
    expect(result.passed).toBe(true);
    expect(callWorkerFn).toHaveBeenCalledWith(config, "/repo", expect.objectContaining({
      worker: "workers/api",
      path: "/health",
      method: "GET",
    }));
    expect(sendQueueMessageFn).toHaveBeenCalledWith(config, "/repo", expect.objectContaining({
      queue: "payment-outbox",
      payload: '{"type":"job.created"}',
      worker: "workers/api",
    }));
    expect(executeLocalD1Fn).toHaveBeenCalledWith(config, "/repo", expect.anything(), expect.objectContaining({
      database: "payments-db",
      sql: "SELECT 1 AS ok",
      worker: "workers/api",
    }));
  });

  it("runs a named verify pack with json assertions", async ({ task }) => {
    story.init(task);

    story.given("a verify-local pack that asserts json response bodies");
    const config: CfStageConfig = {
      version: 1,
      workers: ["workers/api"],
      resources: {
        "payment-outbox": {
          type: "queue",
          bindings: {
            "workers/api": { producer: "OUTBOX_QUEUE" },
          },
        },
      },
      fixtures: {
        "api-health": {
          type: "worker",
          worker: "workers/api",
          path: "/health",
          method: "GET",
        },
      },
      verifyLocal: {
        checks: [],
        packs: {
          smoke: {
            checks: [
              {
                type: "worker",
                name: "api health",
                worker: "workers/api",
                fixture: "api-health",
                expectStatus: 200,
                expectJsonIncludes: { ok: true, region: "local" },
                expectHeaders: { "content-type": "application/json" },
              },
            ],
          },
        },
      },
    };

    const result = await verifyLocal({
      rootDir: "/repo",
      config,
      pack: "smoke",
      callWorkerFn: vi.fn().mockResolvedValue({
        target: { workerPath: "workers/api", port: 8787, path: "/health", url: "http://127.0.0.1:8787/health" },
        method: "GET",
        status: 200,
        ok: true,
        body: '{"ok":true,"region":"local","extra":"value"}',
        headers: { "content-type": "application/json" },
      }),
      sendQueueMessageFn: vi.fn(),
      triggerCronFn: vi.fn(),
      resolvePlannedWorkerPortFn: vi.fn(),
      executeLocalD1Fn: vi.fn(),
    });

    story.then("the named pack passes and is reported in the result");
    expect(result.passed).toBe(true);
    expect(result.pack).toBe("smoke");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.passed).toBe(true);
  });

  it("fails when no local verification config exists", async ({ task }) => {
    story.init(task);

    story.given("a config without verifyLocal");
    const result = await verifyLocal({
      rootDir: "/repo",
      config: { ...mockConfig, verifyLocal: undefined },
    });

    story.then("the command fails fast with a configuration check");
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.name).toBe("Local verify config");
  });
});
