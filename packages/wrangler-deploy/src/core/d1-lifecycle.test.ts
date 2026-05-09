import { describe, expect, it, vi } from "vitest";
import type { CfStageConfig, StageState } from "../types.js";
import type { ApplyDeps } from "./apply.js";
import type { StateProvider } from "./state.js";
import { apply } from "./apply.js";

function makeProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

function stubDeps(over: Partial<ApplyDeps> & { config: CfStageConfig; state: StateProvider }): ApplyDeps {
  return {
    rootDir: "/repo",
    wrangler: { run: vi.fn().mockReturnValue("ok") },
    createD1: vi.fn().mockReturnValue({ id: "d1_id", name: "users-db-dev", version: "v1" }),
    createR2: vi.fn().mockReturnValue({ name: "x" }),
    createVectorize: vi.fn().mockReturnValue({ id: "v", name: "x" }),
    readConfig: vi.fn().mockReturnValue({ name: "api", main: "src/index.ts" }),
    renderConfig: vi.fn().mockImplementation((cfg) => cfg),
    writeConfigs: vi.fn(),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    applyD1Migrations: vi.fn().mockReturnValue("migrations applied"),
    executeD1File: vi.fn().mockReturnValue("import ok"),
    ...over,
  };
}

const baseConfig: CfStageConfig = {
  version: 1,
  workers: ["apps/api"],
  resources: {
    "users-db": {
      type: "d1",
      bindings: { "apps/api": "DB" },
      migrationsDir: "./migrations",
      migrationsTable: "drizzle_migrations",
      importFiles: ["./seed.sql", "./fixtures.sql"],
    },
  },
};

describe("D1 migrations and importFiles on apply", () => {
  it("on first create: runs imports then migrations", async () => {
    const deps = stubDeps({ config: baseConfig, state: makeProvider(null) });
    await apply({ stage: "dev" }, deps);

    expect(deps.executeD1File).toHaveBeenCalledTimes(2);
    expect((deps.executeD1File as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      name: "users-db-dev",
      remote: true,
    });
    expect(deps.applyD1Migrations).toHaveBeenCalledTimes(1);
    expect((deps.applyD1Migrations as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      name: "users-db-dev",
      migrationsTable: "drizzle_migrations",
      remote: true,
    });
  });

  it("on subsequent applies (in-sync): skips imports, still runs migrations", async () => {
    const existing: StageState = {
      stage: "dev",
      createdAt: "x",
      updatedAt: "x",
      resources: {
        "users-db": {
          type: "d1",
          lifecycleStatus: "created",
          source: "managed",
          props: { type: "d1", name: "users-db-dev", bindings: {} },
          output: { id: "d1_id", name: "users-db-dev", version: "v1" },
        },
      },
      workers: {},
      secrets: {},
    };
    const deps = stubDeps({ config: baseConfig, state: makeProvider(existing) });
    await apply({ stage: "dev" }, deps);

    expect(deps.executeD1File).not.toHaveBeenCalled();
    expect(deps.applyD1Migrations).toHaveBeenCalledTimes(1);
  });

  it("skips both when neither migrationsDir nor importFiles is set", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        "users-db": { type: "d1", bindings: { "apps/api": "DB" } },
      },
    };
    const deps = stubDeps({ config, state: makeProvider(null) });
    await apply({ stage: "dev" }, deps);

    expect(deps.executeD1File).not.toHaveBeenCalled();
    expect(deps.applyD1Migrations).not.toHaveBeenCalled();
  });
});
