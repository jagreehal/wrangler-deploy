import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { buildDevPlan } from "./dev.js";
import type { CfStageConfig } from "../types.js";
import type { StateProvider } from "./state.js";
import type { StageState } from "../types.js";

const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../apps/example");

function makeConfig(overrides?: Partial<CfStageConfig>): CfStageConfig {
  return {
    version: 1,
    workers: ["workers/api", "workers/batch-workflow", "workers/event-router"],
    resources: {},
    serviceBindings: {
      "workers/api": { WORKFLOWS: "workers/batch-workflow" },
    },
    ...overrides,
  };
}

describe("buildDevPlan", () => {
  it("creates plan for all workers in dependency order", async ({ task }) => {
    story.init(task);

    const config = makeConfig();

    story.given("a config with api depending on batch-workflow");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787 });

    story.then("plan contains both workers in dependency order (batch-workflow before api)");
    expect(plan.workers).toHaveLength(3);
    const paths = plan.workers.map((w) => w.workerPath);
    expect(paths.indexOf("workers/batch-workflow")).toBeLessThan(paths.indexOf("workers/api"));
  });

  it("each worker has a unique port assigned", async ({ task }) => {
    story.init(task);

    const config = makeConfig();

    story.given("a config with three workers");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787 });

    story.then("each worker has a port >= basePort and all ports are unique");
    const ports = plan.workers.map((w) => w.port);
    expect(new Set(ports).size).toBe(3);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(8787);
    }
  });

  it("filter includes only target and transitive deps", async ({ task }) => {
    story.init(task);

    const config = makeConfig({
      workers: ["workers/api", "workers/batch-workflow", "workers/event-router", "workers/extra"],
      serviceBindings: {
        "workers/api": { WORKFLOWS: "workers/batch-workflow" },
        "workers/batch-workflow": { EVENTS: "workers/event-router" },
      },
    });

    story.given("api -> batch-workflow -> event-router, plus an unrelated worker");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787, filter: "workers/api" });

    story.then("plan only contains workers/api, workers/batch-workflow, workers/event-router");
    const paths = plan.workers.map((w) => w.workerPath);
    expect(paths).toContain("workers/api");
    expect(paths).toContain("workers/batch-workflow");
    expect(paths).toContain("workers/event-router");
    expect(paths).not.toContain("workers/extra");
  });

  it("custom devArgs are included in worker args", async ({ task }) => {
    story.init(task);

    const config = makeConfig();

    story.given("workerOptions with custom devArgs for workers/api");
    const plan = await buildDevPlan(config, exampleRoot, {
      basePort: 8787,
      workerOptions: {
        "workers/api": { devArgs: ["--local", "--test-scheduled"] },
      },
    });

    story.then("the worker args include the custom devArgs");
    const apiWorker = plan.workers.find((w) => w.workerPath === "workers/api");
    expect(apiWorker?.args).toContain("--local");
    expect(apiWorker?.args).toContain("--test-scheduled");
  });

  it("uses config.dev port overrides before probing", async ({ task }) => {
    story.init(task);

    const config = makeConfig({
      dev: {
        ports: {
          "workers/api": 9000,
        },
      },
    });

    story.given("a config with a persisted dev port override");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787 });

    story.then("the planned worker port uses the configured override");
    const apiWorker = plan.workers.find((w) => w.workerPath === "workers/api");
    expect(apiWorker?.port).toBe(9000);
  });

  it("builds a shared Wrangler session when configured", async ({ task }) => {
    story.init(task);

    const config = makeConfig({
      dev: {
        args: ["--log-level", "debug"],
        session: {
          enabled: true,
          entryWorker: "workers/api",
          persistTo: ".wrangler/state",
          args: ["--local"],
        },
      },
    });

    story.given("a config opting into Wrangler's multi-config local session");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787 });

    story.then("the plan uses a single session with all worker configs and shared state");
    expect(plan.mode).toBe("session");
    expect(plan.session?.entryWorkerPath).toBe("workers/api");
    expect(plan.session?.args).toContain("--persist-to");
    expect(plan.session?.args).toContain(resolve(exampleRoot, ".wrangler/state"));
    expect(plan.session?.args).toContain("--log-level");
    expect(plan.session?.args).toContain("--local");
    expect(plan.session?.configPaths).toHaveLength(3);
  });

  it("renders stage bindings directly when stage is provided", async ({ task }) => {
    story.init(task);

    const mockState: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "payments-db": {
          type: "d1",
          lifecycleStatus: "created",
          props: { type: "d1", name: "payments-db-staging", bindings: {} },
          output: { id: "d1-stage-id", name: "payments-db-staging" },
          source: "managed",
        },
        "token-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "token-kv-staging", bindings: {} },
          output: { id: "kv-token-id", title: "token-kv-staging" },
          source: "managed",
        },
        "cache-kv": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "cache-kv-staging", bindings: {} },
          output: { id: "kv-cache-id", title: "cache-kv-staging" },
          source: "managed",
        },
        "payment-outbox": {
          type: "queue",
          lifecycleStatus: "created",
          props: { type: "queue", name: "payment-outbox-staging", bindings: {} },
          output: { name: "payment-outbox-staging" },
          source: "managed",
        },
        "payment-outbox-dlq": {
          type: "queue",
          lifecycleStatus: "created",
          props: { type: "queue", name: "payment-outbox-dlq-staging", bindings: {} },
          output: { name: "payment-outbox-dlq-staging" },
          source: "managed",
        },
      },
      workers: {
        "workers/api": { name: "payment-api-staging" },
        "workers/batch-workflow": { name: "payment-batch-workflow-staging" },
        "workers/event-router": { name: "payment-event-router-staging" },
      },
      secrets: {},
    };

    const mockProvider: StateProvider = {
      read: vi.fn().mockResolvedValue(mockState),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const stageConfig: CfStageConfig = {
      version: 1,
      workers: ["workers/api", "workers/batch-workflow", "workers/event-router"],
      resources: {
        "payments-db": {
          type: "d1",
          bindings: {
            "workers/api": "DB",
            "workers/batch-workflow": "DB",
            "workers/event-router": "DB",
          },
        },
        "token-kv": {
          type: "kv",
          bindings: {
            "workers/api": "TOKEN_KV",
          },
        },
        "cache-kv": {
          type: "kv",
          bindings: {
            "workers/batch-workflow": "CACHE_KV",
          },
        },
        "payment-outbox": {
          type: "queue",
          bindings: {
            "workers/api": { producer: "OUTBOX_QUEUE" },
            "workers/batch-workflow": { producer: "OUTBOX_QUEUE" },
            "workers/event-router": { producer: "OUTBOX_QUEUE", consumer: true },
          },
        },
        "payment-outbox-dlq": {
          type: "queue",
          bindings: {
            "workers/event-router": { deadLetterFor: "payment-outbox" },
          },
        },
      },
      serviceBindings: {
        "workers/api": {
          WORKFLOWS: "workers/batch-workflow",
        },
      },
      dev: {
        session: {
          entryWorker: "workers/api",
          persistTo: ".wrangler/state",
        },
      },
    };

    story.given("an example config and a rendered staging state");
    const plan = await buildDevPlan(stageConfig, exampleRoot, {
      basePort: 8787,
      stage: "staging",
      stateProvider: mockProvider,
      session: true,
    });

    story.then("dev config paths point at rendered stage configs");
    expect(plan.workers.every((worker) => worker.configPath.includes(".wrangler-deploy/dev/staging/"))).toBe(true);
    expect(plan.session?.configPaths.every((path) => path.includes(".wrangler-deploy/dev/staging/"))).toBe(true);

    const renderedApiConfig = readFileSync(
      resolve(exampleRoot, ".wrangler-deploy/dev/staging/workers/api/wrangler.rendered.jsonc"),
      "utf-8",
    );

    story.and("the rendered config contains the stage bindings");
    expect(renderedApiConfig).toContain('"database_id": "d1-stage-id"');
    expect(renderedApiConfig).toContain('"id": "kv-token-id"');
    expect(renderedApiConfig).toContain('"queue": "payment-outbox-staging"');
    expect(renderedApiConfig).toContain('"service": "payment-batch-workflow-staging"');
    expect(renderedApiConfig).not.toContain("placeholder");
  });

  it("includes matching companion commands in the plan", async ({ task }) => {
    story.init(task);

    const config = makeConfig({
      dev: {
        companions: [
          {
            name: "dev:cron",
            command: "pnpm dev:cron",
            cwd: "workers/batch-workflow",
            workers: ["workers/batch-workflow"],
          },
          {
            name: "other",
            command: "echo other",
            workers: ["workers/unknown"],
          },
        ],
      },
    });

    story.given("a worker-scoped companion command for batch-workflow");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787, filter: "workers/api" });

    story.then("only companions matching the filtered workers are included");
    expect(plan.companions).toEqual([
      {
        name: "dev:cron",
        command: "pnpm dev:cron",
        cwd: resolve(exampleRoot, "workers/batch-workflow"),
        env: undefined,
      },
    ]);
  });

  it("throws when filter references an unknown worker", async ({ task }) => {
    story.init(task);

    const config = makeConfig();

    story.given("a filter for a worker path that is not declared in the config");

    story.then("building the plan fails fast instead of producing an empty dev session");
    await expect(() =>
      buildDevPlan(config, exampleRoot, {
        basePort: 8787,
        filter: "workers/missing-worker",
      }),
    ).rejects.toThrow(/unknown worker/i);
  });

  it("startDev preserves explicit planned ports instead of compacting them", async ({ task }) => {
    story.init(task);
    story.given("a plan with non-consecutive explicit worker ports");

    vi.resetModules();

    const spawnMock = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
    }));

    const findAvailablePortsMock = vi
      .fn()
      .mockResolvedValueOnce([9000])
      .mockResolvedValueOnce([9100])
      .mockResolvedValueOnce([9200])
      .mockResolvedValueOnce([9229, 9230, 9231]);

    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("./port-finder.js", () => ({ findAvailablePorts: findAvailablePortsMock }));

    const { startDev } = await import("./dev.js");

    const handle = await startDev(
      {
        mode: "workers",
        workers: [
          {
            workerPath: "workers/api",
            cwd: "/repo/workers/api",
            configPath: "/repo/workers/api/wrangler.jsonc",
            port: 9000,
            args: [],
          },
          {
            workerPath: "workers/batch-workflow",
            cwd: "/repo/workers/batch-workflow",
            configPath: "/repo/workers/batch-workflow/wrangler.jsonc",
            port: 9100,
            args: [],
          },
          {
            workerPath: "workers/event-router",
            cwd: "/repo/workers/event-router",
            configPath: "/repo/workers/event-router/wrangler.jsonc",
            port: 9200,
            args: [],
          },
        ],
        companions: [],
        ports: {
          "workers/api": 9000,
          "workers/batch-workflow": 9100,
          "workers/event-router": 9200,
        },
      },
      { output: () => {} },
    );

    story.then("the resolved dev ports still match the per-worker planned ports");
    expect(handle.ports).toEqual({
      "workers/api": 9000,
      "workers/batch-workflow": 9100,
      "workers/event-router": 9200,
    });
  });

  it("startDev launches a single Wrangler session and companion processes", async ({ task }) => {
    story.init(task);
    story.given("a session-mode plan with one companion command");

    vi.resetModules();

    const spawnMock = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
    }));

    const findAvailablePortsMock = vi
      .fn()
      .mockResolvedValueOnce([8787])
      .mockResolvedValueOnce([9229]);

    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("./port-finder.js", () => ({ findAvailablePorts: findAvailablePortsMock }));

    const { startDev } = await import("./dev.js");

    const handle = await startDev(
      {
        mode: "session",
        workers: [],
        companions: [
          {
            name: "dev:cron",
            cwd: "/repo/workers/batch-workflow",
            command: "pnpm dev:cron",
          },
        ],
        ports: {
          "workers/api": 8787,
        },
        session: {
          cwd: "/repo",
          entryWorkerPath: "workers/api",
          workerPaths: ["workers/api", "workers/event-router"],
          configPaths: [
            "/repo/workers/api/wrangler.jsonc",
            "/repo/workers/event-router/wrangler.jsonc",
          ],
          port: 8787,
          args: [
            "-c",
            "/repo/workers/api/wrangler.jsonc",
            "-c",
            "/repo/workers/event-router/wrangler.jsonc",
            "--persist-to",
            "/repo/.wrangler/state",
          ],
        },
      },
      { output: () => {} },
    );

    story.then("wrangler is spawned once for the shared session and once for the companion");
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "npx",
      [
        "wrangler",
        "dev",
        "--port",
        "8787",
        "--inspector-port",
        "9229",
        "-c",
        "/repo/workers/api/wrangler.jsonc",
        "-c",
        "/repo/workers/event-router/wrangler.jsonc",
        "--persist-to",
        "/repo/.wrangler/state",
      ],
      {
        cwd: "/repo",
        shell: false,
      },
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "pnpm dev:cron",
      expect.objectContaining({
        cwd: "/repo/workers/batch-workflow",
        env: expect.objectContaining({
          WD_DEV_ENTRY_WORKER: "workers/api",
          WD_DEV_ENTRY_URL: "http://127.0.0.1:8787",
          WD_DEV_PORTS: JSON.stringify({ "workers/api": 8787 }),
        }),
        shell: true,
      }),
    );
    expect(handle.ports).toEqual({
      "workers/api": 8787,
    });
  });

  it("read-mode: only starts filter target and populates serviceBindingFallbacks from state", async ({ task }) => {
    story.init(task);

    const mockState: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {},
      workers: {
        "workers/batch-workflow": { name: "batch-workflow-staging" },
      },
      secrets: {},
    };
    const mockProvider: StateProvider = {
      read: vi.fn().mockResolvedValue(mockState),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const config = makeConfig({
      workers: ["workers/api", "workers/batch-workflow", "workers/event-router"],
      serviceBindings: {
        "workers/api": { WORKFLOWS: "workers/batch-workflow" },
      },
    });

    story.given("a config with api -> batch-workflow, and a fallback stage with batch-workflow deployed");
    const plan = await buildDevPlan(config, exampleRoot, {
      basePort: 8787,
      filter: "workers/api",
      fallbackStage: "staging",
      stateProvider: mockProvider,
    });

    story.then("only workers/api is started and WORKFLOWS binding maps to the deployed name");
    expect(plan.workers).toHaveLength(1);
    expect(plan.workers[0]!.workerPath).toBe("workers/api");
    expect(plan.workers[0]!.serviceBindingFallbacks).toEqual({ WORKFLOWS: "batch-workflow-staging" });
  });

  it("read-mode: warns and maps to null when excluded worker is not in fallback state", async ({ task }) => {
    story.init(task);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockState: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {},
      workers: {},  // batch-workflow not in state
      secrets: {},
    };
    const mockProvider: StateProvider = {
      read: vi.fn().mockResolvedValue(mockState),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const config = makeConfig({
      workers: ["workers/api", "workers/batch-workflow"],
      serviceBindings: {
        "workers/api": { WORKFLOWS: "workers/batch-workflow" },
      },
    });

    story.given("a config with api -> batch-workflow, and fallback state that does not include batch-workflow");
    const plan = await buildDevPlan(config, exampleRoot, {
      basePort: 8787,
      filter: "workers/api",
      fallbackStage: "staging",
      stateProvider: mockProvider,
    });

    story.then("the binding is mapped to null and a warning is logged");
    expect(plan.workers[0]!.serviceBindingFallbacks).toEqual({ WORKFLOWS: null });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("workers/batch-workflow"));
    warnSpy.mockRestore();
  });

  it("read-mode: throws when fallback stage state is not found", async ({ task }) => {
    story.init(task);

    const mockProvider: StateProvider = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const config = makeConfig({
      workers: ["workers/api", "workers/batch-workflow"],
      serviceBindings: {
        "workers/api": { WORKFLOWS: "workers/batch-workflow" },
      },
    });

    story.given("a fallback stage that has no state on disk");
    story.then("buildDevPlan throws with a helpful error");
    await expect(
      buildDevPlan(config, exampleRoot, {
        basePort: 8787,
        filter: "workers/api",
        fallbackStage: "staging",
        stateProvider: mockProvider,
      }),
    ).rejects.toThrow(/fallback stage "staging" not found/i);
  });

  it("filter without fallback stage still expands transitive deps (existing behavior unchanged)", async ({ task }) => {
    story.init(task);

    const config = makeConfig({
      workers: ["workers/api", "workers/batch-workflow", "workers/event-router"],
      serviceBindings: {
        "workers/api": { WORKFLOWS: "workers/batch-workflow" },
        "workers/batch-workflow": { EVENTS: "workers/event-router" },
      },
    });

    story.given("a filter with no fallback stage");
    const plan = await buildDevPlan(config, exampleRoot, { basePort: 8787, filter: "workers/api" });

    story.then("plan includes all transitive deps and no serviceBindingFallbacks");
    const paths = plan.workers.map((w) => w.workerPath);
    expect(paths).toContain("workers/api");
    expect(paths).toContain("workers/batch-workflow");
    expect(paths).toContain("workers/event-router");
    expect(plan.workers.every((w) => !w.serviceBindingFallbacks)).toBe(true);
  });

  it("read-mode: starts filter target cleanly when it has no service bindings", async ({ task }) => {
    story.init(task);

    const mockState: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {},
      workers: {},
      secrets: {},
    };
    const mockProvider: StateProvider = {
      read: vi.fn().mockResolvedValue(mockState),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const config = makeConfig({
      workers: ["workers/api", "workers/batch-workflow"],
      serviceBindings: {},
    });

    story.given("a config where the filter target has no outgoing service bindings");
    const plan = await buildDevPlan(config, exampleRoot, {
      basePort: 8787,
      filter: "workers/api",
      fallbackStage: "staging",
      stateProvider: mockProvider,
    });

    story.then("the plan starts only the filter target with no fallback bindings");
    expect(plan.workers).toHaveLength(1);
    expect(plan.workers[0]!.workerPath).toBe("workers/api");
    expect(plan.workers[0]!.serviceBindingFallbacks).toBeUndefined();
  });

  it("startDev: writes dev override config and passes --config when worker has serviceBindingFallbacks", async ({ task }) => {
    story.init(task);
    story.given("a workers-mode plan where workers/api has a fallback binding to batch-workflow-staging");

    vi.resetModules();

    const spawnMock = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
    }));

    const writeFileSyncMock = vi.fn();
    const mkdirSyncMock = vi.fn();

    const findAvailablePortsMock = vi
      .fn()
      .mockResolvedValueOnce([9000])
      .mockResolvedValueOnce([9229]);

    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("node:fs", () => ({
      existsSync: vi.fn().mockReturnValue(true),
      writeFileSync: writeFileSyncMock,
      mkdirSync: mkdirSyncMock,
    }));
    vi.doMock("./port-finder.js", () => ({ findAvailablePorts: findAvailablePortsMock }));

    const { startDev } = await import("./dev.js");

    const overrideDir = "/repo/.wrangler-deploy/dev/workers/api";
    const overridePath = `${overrideDir}/wrangler.dev.jsonc`;

    await startDev(
      {
        mode: "workers",
        workers: [
          {
            workerPath: "workers/api",
            cwd: "/repo/workers/api",
            configPath: "/repo/workers/api/wrangler.jsonc",
            port: 9000,
            args: [],
            serviceBindingFallbacks: { WORKFLOWS: "batch-workflow-staging" },
          },
        ],
        companions: [],
        ports: { "workers/api": 9000 },
      },
      { output: () => {}, rootDir: "/repo" },
    );

    story.then("the override config file is written and --config is passed to wrangler");
    expect(mkdirSyncMock).toHaveBeenCalledWith(overrideDir, { recursive: true });
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      overridePath,
      expect.stringContaining('"WORKFLOWS"'),
    );
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      overridePath,
      expect.stringContaining('"batch-workflow-staging"'),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["--config", overridePath]),
      expect.anything(),
    );
    vi.resetModules();
  });

  it("throws when fallbackStage is provided without stateProvider", async ({ task }) => {
    story.init(task);

    const config = makeConfig({
      workers: ["workers/api"],
    });

    story.given("fallbackStage is set but stateProvider is omitted");
    story.then("buildDevPlan throws immediately rather than silently falling back to transitive-dep mode");
    await expect(
      buildDevPlan(config, exampleRoot, {
        basePort: 8787,
        fallbackStage: "staging",
        // stateProvider intentionally omitted
      }),
    ).rejects.toThrow(/stage\/fallback-stage dev requires stateProvider/i);
  });

  it("throws when read-mode and session mode are combined", async ({ task }) => {
    story.init(task);

    const mockProvider: StateProvider = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    const config = makeConfig({
      workers: ["workers/api"],
      dev: { session: { enabled: true } },
    });

    story.given("both fallbackStage and session mode are requested");
    story.then("buildDevPlan throws since read-mode + session are incompatible");
    await expect(
      buildDevPlan(config, exampleRoot, {
        basePort: 8787,
        filter: "workers/api",
        fallbackStage: "staging",
        stateProvider: mockProvider,
        session: true,
      }),
    ).rejects.toThrow(/not compatible with session mode/i);
  });
});
