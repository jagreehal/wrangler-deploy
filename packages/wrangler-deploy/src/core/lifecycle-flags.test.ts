import { describe, expect, it, vi } from "vitest";
import type { CfStageConfig, StageState } from "../types.js";
import type { ApplyDeps } from "./apply.js";
import type { DestroyDeps } from "./destroy.js";
import type { StateProvider } from "./state.js";
import { apply } from "./apply.js";
import { destroy } from "./destroy.js";

/**
 * Coverage for the per-resource adopt and delete: false lifecycle flags.
 * These tests bypass the network — they assert wiring, not Cloudflare
 * behaviour.
 */

function makeProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

function stubApplyDeps(over: Partial<ApplyDeps> & { config: CfStageConfig; state: StateProvider }): ApplyDeps {
  return {
    rootDir: "/repo",
    wrangler: { run: vi.fn().mockReturnValue('{"id":"generated"}') },
    createD1: vi.fn().mockReturnValue({ id: "d1", name: "x", version: "v1" }),
    createR2: vi.fn().mockReturnValue({ name: "x" }),
    createVectorize: vi.fn().mockReturnValue({ id: "v", name: "x" }),
    readConfig: vi.fn().mockReturnValue({ name: "api", main: "src/index.ts" }),
    renderConfig: vi.fn().mockImplementation((cfg) => cfg),
    writeConfigs: vi.fn(),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}

describe("adopt: false errors loudly when the resource exists", () => {
  it("rejects when wrangler reports already exists and adopt is explicitly false", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        cache: { type: "kv", adopt: false, bindings: { "apps/api": "CACHE" } },
      },
    };
    const provider = makeProvider(null);
    const wrangler = {
      run: vi.fn().mockImplementation(() => {
        throw new Error("kv namespace already exists");
      }),
    };
    await expect(
      apply({ stage: "dev" }, stubApplyDeps({ config, state: provider, wrangler })),
    ).rejects.toThrow(/adopt: false is set/);
  });

  it("adopts silently by default (no adopt flag)", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        cache: { type: "kv", bindings: { "apps/api": "CACHE" } },
      },
    };
    const provider = makeProvider(null);
    const wrangler = {
      run: vi
        .fn()
        // create call: simulate already-exists
        .mockImplementationOnce(() => {
          throw new Error("kv namespace already exists");
        })
        // list call to look up id by title
        .mockReturnValue(
          '[{"id":"abc12345abc12345abc12345abc12345","title":"cache-kv-dev"}]'.replace(
            "cache-kv-dev",
            "cache-kv-dev",
          ),
        ),
    };
    const result = await apply(
      { stage: "dev" },
      stubApplyDeps({ config, state: provider, wrangler }),
    );
    const cache = result.resources.cache;
    expect(cache?.lifecycleStatus).toBe("created");
  });

  it("fails fast when adopt is set on an unsupported resource type", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        db: { type: "d1", adopt: true, bindings: { "apps/api": "DB" } },
      },
    };
    const provider = makeProvider(null);
    await expect(
      apply({ stage: "dev" }, stubApplyDeps({ config, state: provider })),
    ).rejects.toThrow(/does not support adopt/);
  });
});

describe("delete: false skips physical deletion on destroy", () => {
  function destroyDeps(over: Partial<DestroyDeps> & { config: CfStageConfig; state: StateProvider }): DestroyDeps {
    return {
      rootDir: "/repo",
      wrangler: { run: vi.fn().mockReturnValue("ok") },
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ...over,
    };
  }

  it("removes the resource from state but does not call wrangler delete", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        cache: { type: "kv", delete: false, bindings: { "apps/api": "CACHE" } },
      },
      stages: { dev: { protected: false } },
    };
    const state: StageState = {
      stage: "dev",
      createdAt: "x",
      updatedAt: "x",
      resources: {
        cache: {
          type: "kv",
          lifecycleStatus: "created",
          source: "managed",
          props: { type: "kv", name: "cache-kv-dev", bindings: {} },
          output: { id: "kv_keep", title: "cache-kv-dev" },
        },
      },
      workers: {},
      secrets: {},
    };
    const provider = makeProvider(state);
    const wrangler = { run: vi.fn().mockReturnValue("ok") };

    const result = await destroy(
      { stage: "dev" },
      destroyDeps({ config, state: provider, wrangler }),
    );

    const calls = (wrangler.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    const ranKvDelete = calls.some((args) =>
      Array.isArray(args) && args[0] === "kv" && args[1] === "namespace" && args[2] === "delete",
    );
    expect(ranKvDelete).toBe(false);
    expect(result.destroyedResources).not.toContain("cache-kv-dev");
  });

  it("still deletes resources without delete: false", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {
        cache: { type: "kv", bindings: { "apps/api": "CACHE" } },
      },
      stages: { dev: { protected: false } },
    };
    const state: StageState = {
      stage: "dev",
      createdAt: "x",
      updatedAt: "x",
      resources: {
        cache: {
          type: "kv",
          lifecycleStatus: "created",
          source: "managed",
          props: { type: "kv", name: "cache-kv-dev", bindings: {} },
          output: { id: "kv_drop", title: "cache-kv-dev" },
        },
      },
      workers: {},
      secrets: {},
    };
    const provider = makeProvider(state);
    const wrangler = { run: vi.fn().mockReturnValue("ok") };

    await destroy(
      { stage: "dev" },
      destroyDeps({ config, state: provider, wrangler }),
    );

    const calls = (wrangler.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    const ranKvDelete = calls.some((args) =>
      Array.isArray(args) && args[0] === "kv" && args[1] === "namespace" && args[2] === "delete",
    );
    expect(ranKvDelete).toBe(true);
  });

  it("keeps resources with delete: false even when removed from config", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {},
      stages: { dev: { protected: false } },
    };
    const state: StageState = {
      stage: "dev",
      createdAt: "x",
      updatedAt: "x",
      resources: {
        cache: {
          type: "kv",
          lifecycleStatus: "created",
          source: "managed",
          props: { type: "kv", name: "cache-kv-dev", bindings: {}, delete: false },
          output: { id: "kv_keep", title: "cache-kv-dev" },
        },
      },
      workers: {},
      secrets: {},
    };
    const provider = makeProvider(state);
    const wrangler = { run: vi.fn().mockReturnValue("ok") };

    const result = await destroy(
      { stage: "dev" },
      destroyDeps({ config, state: provider, wrangler }),
    );

    const calls = (wrangler.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    const ranKvDelete = calls.some((args) =>
      Array.isArray(args) && args[0] === "kv" && args[1] === "namespace" && args[2] === "delete",
    );
    expect(ranKvDelete).toBe(false);
    expect(result.destroyedResources).not.toContain("cache-kv-dev");
  });
});
