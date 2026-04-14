import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { deploy } from "./deploy.js";
import type { StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";

function createMockState(overrides?: Partial<StageState>): StageState {
  return {
    stage: "staging",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    resources: {},
    workers: {
      "apps/api": { name: "api-staging" },
    },
    secrets: {},
    ...overrides,
  };
}

function createMockStateProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

describe("deploy", () => {
  it("deploys each worker from its own directory", async ({ task }) => {
    story.init(task);

    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };
    const state = createMockState();
    const provider = createMockStateProvider(state);

    story.given("a worker with rendered config");

    story.when("deploy is called");
    const result = await deploy(
      { stage: "staging" },
      {
        rootDir: "/repo",
        config: {
          version: 1,
          workers: ["apps/api"],
          deployOrder: ["apps/api"],
          resources: {},
        },
        state: provider,
        wrangler,
        validateSecretsFn: vi.fn().mockResolvedValue([]),
      },
    );

    story.then("workers are deployed using wrangler");
    expect(wrangler.run).toHaveBeenCalledWith(
      ["deploy", "-c", "/repo/.wrangler-deploy/staging/apps/api/wrangler.rendered.jsonc"],
      "/repo/apps/api",
    );
    expect(result.deployedWorkers).toEqual([
      {
        workerPath: "apps/api",
        name: "api-staging",
        renderedConfigPath: "/repo/.wrangler-deploy/staging/apps/api/wrangler.rendered.jsonc",
      },
    ]);
  });

  it("blocks deploys when declared secrets are missing", async ({ task }) => {
    story.init(task);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };

    story.given("a stage with workers and declared secrets");
    const state = createMockState({
      secrets: {
        "apps/api": { API_TOKEN: "missing" },
      },
    });
    const provider = createMockStateProvider(state);

    story.when("deploy is called with missing secrets");
    await expect(
      deploy(
        { stage: "staging" },
        {
          rootDir: "/repo",
          config: {
            version: 1,
            workers: ["apps/api"],
            deployOrder: ["apps/api"],
            resources: {},
            secrets: {
              "apps/api": ["API_TOKEN", "ANOTHER_SECRET"],
            },
          },
          state: provider,
          wrangler,
          validateSecretsFn: vi
            .fn()
            .mockResolvedValue(["apps/api/API_TOKEN", "apps/api/ANOTHER_SECRET"]),
        },
      ),
    ).rejects.toThrow("Deploy blocked by missing secrets. Set them first.");

    story.then("deploy is blocked with error");
    expect(logSpy).toHaveBeenCalledWith("\n  Blocked: 2 missing secret(s):\n");
    expect(logSpy).toHaveBeenCalledWith("    x apps/api/API_TOKEN");
    expect(logSpy).toHaveBeenCalledWith("    x apps/api/ANOTHER_SECRET");
    expect(wrangler.run).not.toHaveBeenCalled();
  });
});
