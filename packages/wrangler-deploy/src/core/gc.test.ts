import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { gc } from "./gc.js";
import type { CfStageConfig } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";

const config: CfStageConfig = {
  version: 1,
  workers: [],
  deployOrder: [],
  resources: {},
  stages: {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
};

function createMockProvider(
  stages: string[],
  stateByStage: Record<string, unknown>,
): StateProvider {
  return {
    list: vi.fn().mockResolvedValue(stages),
    read: vi
      .fn()
      .mockImplementation((stage: string) => Promise.resolve(stateByStage[stage] ?? null)),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const mockWrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };

describe("gc", () => {
  it("destroys expired PR stages", async ({ task }) => {
    story.init(task);

    story.given("a list with one expired PR stage");
    const destroyFn = vi.fn().mockResolvedValue(undefined);
    const provider = createMockProvider(["pr-100"], {
      "pr-100": {
        stage: "pr-100",
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: "",
        resources: {},
        workers: {},
        secrets: {},
      },
    });

    const result = await gc(
      {},
      {
        rootDir: "/repo",
        config,
        state: provider,
        wrangler: mockWrangler,
        destroyFn,
      },
    );

    story.then("the expired PR stage is destroyed");
    expect(result.destroyed).toEqual(["pr-100"]);
    expect(destroyFn).toHaveBeenCalledOnce();
  });

  it("keeps non-expired PR stages", async ({ task }) => {
    story.init(task);

    story.given("a PR stage that is not yet expired");
    const destroyFn = vi.fn();
    const provider = createMockProvider(["pr-200"], {
      "pr-200": {
        stage: "pr-200",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: "",
        resources: {},
        workers: {},
        secrets: {},
      },
    });

    const result = await gc(
      {},
      {
        rootDir: "/repo",
        config,
        state: provider,
        wrangler: mockWrangler,
        destroyFn,
      },
    );

    story.then("the PR stage is kept");
    expect(result.kept).toEqual(["pr-200"]);
    expect(destroyFn).not.toHaveBeenCalled();
  });

  it("never destroys protected stages", async ({ task }) => {
    story.init(task);

    story.given("a protected production stage");
    const destroyFn = vi.fn();
    const ancientState = {
      stage: "production",
      createdAt: new Date(0).toISOString(),
      updatedAt: "",
      resources: {},
      workers: {},
      secrets: {},
    };
    const provider = createMockProvider(["production", "staging"], {
      production: ancientState,
      staging: { ...ancientState, stage: "staging" },
    });

    const result = await gc(
      {},
      {
        rootDir: "/repo",
        config,
        state: provider,
        wrangler: mockWrangler,
        destroyFn,
      },
    );

    story.then("the protected stage is not destroyed");
    expect(result.protected).toContain("production");
    expect(result.protected).toContain("staging");
    expect(destroyFn).not.toHaveBeenCalled();
  });

  it("treats unmatched stages as protected", async ({ task }) => {
    story.init(task);

    story.given("a stage that doesn't match any pattern");
    const destroyFn = vi.fn();
    const provider = createMockProvider(["custom-env"], {
      "custom-env": {
        stage: "custom-env",
        createdAt: new Date(0).toISOString(),
        updatedAt: "",
        resources: {},
        workers: {},
        secrets: {},
      },
    });

    const result = await gc(
      {},
      {
        rootDir: "/repo",
        config,
        state: provider,
        wrangler: mockWrangler,
        destroyFn,
      },
    );

    story.then("the stage is treated as protected");
    expect(result.protected).toEqual(["custom-env"]);
  });
});
