import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { deploy } from "./deploy.js";
import type { StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";

vi.mock("./auth.js", () => ({
  resolveAccountId: vi.fn().mockReturnValue("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"),
}));

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
        urls: [],
        routes: [],
        versionId: undefined,
      },
    ]);
    expect(state.workers["apps/api"]).toEqual({
      name: "api-staging",
      url: "https://dash.cloudflare.com/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/workers/services/view/api-staging",
      urls: [],
      routes: [],
      versionId: undefined,
      deployed: true,
    });
    expect(state.lastDeployedWorker).toBe("apps/api");
    expect(state.deploymentHistory).toEqual([
      {
        at: expect.any(String),
        action: "deploy",
        workerPath: "apps/api",
        workerName: "api-staging",
        versionId: undefined,
        urls: [],
        routes: [],
      },
    ]);
    expect(provider.write).toHaveBeenCalled();
  });

  it("parses deploy output URLs/routes/version and persists them to state", async ({ task }) => {
    story.init(task);

    const wranglerOutput = [
      "Uploaded api-staging (2.0 sec)",
      "https://api-staging.example.workers.dev",
      "api-staging.example.com/*",
      "Route: api-staging-alt.example.com/*",
      "Current Version ID: 111ea3fa-418b-47eb-95fe-a5fd03de0629",
    ].join("\n");

    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue(wranglerOutput) };
    const state = createMockState();
    const provider = createMockStateProvider(state);

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

    expect(result.deployedWorkers[0]).toEqual({
      workerPath: "apps/api",
      name: "api-staging",
      renderedConfigPath: "/repo/.wrangler-deploy/staging/apps/api/wrangler.rendered.jsonc",
      urls: ["https://api-staging.example.workers.dev"],
      routes: ["api-staging.example.com/*", "api-staging-alt.example.com/*"],
      versionId: "111ea3fa-418b-47eb-95fe-a5fd03de0629",
    });

    expect(state.workers["apps/api"]).toEqual({
      name: "api-staging",
      url: "https://api-staging.example.workers.dev",
      urls: ["https://api-staging.example.workers.dev"],
      routes: ["api-staging.example.com/*", "api-staging-alt.example.com/*"],
      versionId: "111ea3fa-418b-47eb-95fe-a5fd03de0629",
      deployed: true,
    });
    expect(state.lastDeployedWorker).toBe("apps/api");
    expect(state.deploymentHistory?.[0]).toMatchObject({
      action: "deploy",
      workerPath: "apps/api",
      workerName: "api-staging",
      versionId: "111ea3fa-418b-47eb-95fe-a5fd03de0629",
    });
    expect(provider.write).toHaveBeenCalled();
  });

  it("parses alternate wrangler output variants", async ({ task }) => {
    story.init(task);

    const wranglerOutput = [
      "Uploaded jobs-staging",
      "https://jobs-staging.example.workers.dev",
      "  - jobs.example.com/*",
      "current version id: 7f6f7f6f-1111-2222-3333-aabbccddeeff",
      "Route: jobs-alt.example.com/*",
      "jobs.example.com/*",
    ].join("\n");

    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue(wranglerOutput) };
    const state = createMockState({
      workers: {
        "apps/api": { name: "api-staging" },
        "apps/jobs": { name: "jobs-staging" },
      },
    });
    const provider = createMockStateProvider(state);

    const result = await deploy(
      { stage: "staging" },
      {
        rootDir: "/repo",
        config: {
          version: 1,
          workers: ["apps/jobs"],
          deployOrder: ["apps/jobs"],
          resources: {},
        },
        state: provider,
        wrangler,
        validateSecretsFn: vi.fn().mockResolvedValue([]),
      },
    );

    expect(result.deployedWorkers[0]?.routes).toEqual(["jobs.example.com/*", "jobs-alt.example.com/*"]);
    expect(result.deployedWorkers[0]?.versionId).toBe("7f6f7f6f-1111-2222-3333-aabbccddeeff");
    expect(provider.write).toHaveBeenCalled();
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
