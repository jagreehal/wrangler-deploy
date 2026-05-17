import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";

const { mockResolveAccountId } = vi.hoisted(() => ({
  mockResolveAccountId: vi.fn(() => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
}));

vi.mock("./auth.js", () => ({
  resolveAccountId: mockResolveAccountId,
  resetResolvedAccountId: vi.fn(),
}));

import { renderWranglerConfig } from "./render.js";
import type { CfStageConfig, StageState, WranglerConfig } from "../types.js";

beforeEach(() => {
  mockResolveAccountId.mockReset();
  mockResolveAccountId.mockReturnValue("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

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

    const rendered = renderWranglerConfig(baseConfig, "apps/api", config, state, "staging", "/repo");

    story.and("main is resolved to an absolute path from the repo root");
    expect(rendered.main).toBe("/repo/apps/api/src/index.ts");

    story.and("account_id is pinned from resolveAccountId for the worker directory");
    expect(rendered.account_id).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(mockResolveAccountId).toHaveBeenCalledWith(resolve("/repo", "apps/api"));
  });

  it("falls back to base wrangler account_id when resolveAccountId throws", ({ task }) => {
    story.init(task);

    story.given("resolveAccountId fails but base config declares account_id");
    mockResolveAccountId.mockImplementation(() => {
      throw new Error("unresolved");
    });

    const baseConfig: WranglerConfig = {
      name: "api",
      main: "src/index.ts",
      account_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
    const rendered = renderWranglerConfig(baseConfig, "apps/api", config, state, "staging", "/repo");

    story.then("account_id comes from the base config");
    expect(rendered.account_id).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("omits account_id when resolveAccountId throws and base has none", ({ task }) => {
    story.init(task);

    story.given("resolveAccountId fails and base config has no account_id");
    mockResolveAccountId.mockImplementation(() => {
      throw new Error("unresolved");
    });

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
    const rendered = renderWranglerConfig(baseConfig, "apps/api", config, state, "staging", "/repo");

    story.then("rendered config has no account_id");
    expect(rendered.account_id).toBeUndefined();
  });

  it("resolves migrations_dir relative to the SOURCE worker directory, not the rendered output dir", ({ task }) => {
    story.init(task);

    story.given("a worker config with migrations_dir as a relative path traversing upward");
    const baseConfig: WranglerConfig = {
      name: "api",
      main: "src/index.ts",
      // wrangler.jsonc fields with snake_case live under the index signature
      migrations_dir: "../../drizzle",
    } as WranglerConfig;

    const config: CfStageConfig = {
      version: 1,
      workers: ["workers/api"],
      deployOrder: ["workers/api"],
      resources: {},
    };

    const state: StageState = {
      stage: "dev",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      resources: {},
      workers: {
        "workers/api": { name: "api-dev" },
      },
      secrets: {},
    };

    story.when("renderWranglerConfig is called with a repo root path");
    const rendered = renderWranglerConfig(baseConfig, "workers/api", config, state, "dev", "/repo");

    story.then(
      "migrations_dir resolves from the SOURCE worker dir (so wrangler finds the migrations regardless of where the rendered config is written)"
    );
    expect(rendered["migrations_dir"]).toBe("/repo/drizzle");
  });

  it("resolves assets.directory and site.bucket relative to the source worker dir", ({ task }) => {
    story.init(task);

    const baseConfig = {
      name: "site",
      main: "src/index.ts",
      assets: { directory: "./public", binding: "ASSETS" },
      site: { bucket: "../static" },
    } as unknown as WranglerConfig;

    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/site"],
      deployOrder: ["apps/site"],
      resources: {},
    };

    const state: StageState = {
      stage: "dev",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      resources: {},
      workers: { "apps/site": { name: "site-dev" } },
      secrets: {},
    };

    const rendered = renderWranglerConfig(baseConfig, "apps/site", config, state, "dev", "/repo");

    const renderedAssets = rendered["assets"] as { directory: string; binding: string };
    expect(renderedAssets.directory).toBe("/repo/apps/site/public");
    expect(renderedAssets.binding).toBe("ASSETS");

    const renderedSite = rendered["site"] as { bucket: string };
    expect(renderedSite.bucket).toBe("/repo/apps/static");
  });
});
