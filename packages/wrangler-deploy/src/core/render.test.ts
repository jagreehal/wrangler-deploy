import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { renderWranglerConfig } from "./render.js";
import type { CfStageConfig, StageState, WranglerConfig } from "../types.js";

describe("renderWranglerConfig", () => {
  it("resolves the worker main entry from the repo root when provided", ({ task }) => {
    story.init(task);

    story.given("a worker config with a relative main entry path");
    const baseConfig: WranglerConfig = {
      name: "api",
      main: "src/index.ts",
    };

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      deployOrder: ["apps/api"],
      resources: {},
    };

    const state: StageState = {
      stage: "staging",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      resources: {},
      workers: {
        "apps/api": { name: "api-staging" },
      },
      secrets: {},
    };

    story.when("renderWranglerConfig is called with a repo root path");
    story.then("it does not throw");
    expect(() =>
      renderWranglerConfig(baseConfig, "apps/api", config, state, "staging", "/repo")
    ).not.toThrow();

    story.and("main is resolved to an absolute path from the repo root");
    expect(
      renderWranglerConfig(baseConfig, "apps/api", config, state, "staging", "/repo").main
    ).toBe("/repo/apps/api/src/index.ts");
  });
});
