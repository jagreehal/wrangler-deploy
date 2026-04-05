import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { buildDevPlan } from "./dev.js";
import type { CfStageConfig } from "../types.js";

function makeConfig(
  workers: string[],
  serviceBindings?: Record<string, Record<string, string>>,
): CfStageConfig {
  return {
    version: 1,
    workers,
    resources: {},
    serviceBindings,
  };
}

describe("buildDevPlan", () => {
  it("creates plan for all workers in dependency order", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api", "apps/worker"], {
      "apps/api": { BACKEND: "apps/worker" },
    });

    story.given("a config with api depending on worker");
    const plan = buildDevPlan(config, "/repo", { basePort: 8787 });

    story.then("plan contains both workers in dependency order (worker before api)");
    expect(plan.workers).toHaveLength(2);
    const paths = plan.workers.map((w) => w.workerPath);
    expect(paths.indexOf("apps/worker")).toBeLessThan(paths.indexOf("apps/api"));
  });

  it("each worker has a unique port assigned", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api", "apps/worker"]);

    story.given("a config with two workers");
    const plan = buildDevPlan(config, "/repo", { basePort: 8787 });

    story.then("each worker has a port >= basePort and all ports are unique");
    const ports = plan.workers.map((w) => w.port);
    expect(new Set(ports).size).toBe(2);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(8787);
    }
  });

  it("filter includes only target and transitive deps", ({ task }) => {
    story.init(task);

    const config = makeConfig(
      ["apps/api", "apps/worker", "apps/auth", "apps/unrelated"],
      {
        "apps/api": { BACKEND: "apps/worker" },
        "apps/worker": { AUTH: "apps/auth" },
      },
    );

    story.given("api -> worker -> auth, plus an unrelated worker");
    const plan = buildDevPlan(config, "/repo", { basePort: 8787, filter: "apps/api" });

    story.then("plan only contains apps/api, apps/worker, apps/auth");
    const paths = plan.workers.map((w) => w.workerPath);
    expect(paths).toContain("apps/api");
    expect(paths).toContain("apps/worker");
    expect(paths).toContain("apps/auth");
    expect(paths).not.toContain("apps/unrelated");
  });

  it("custom devArgs are included in worker args", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api"]);

    story.given("workerOptions with custom devArgs for apps/api");
    const plan = buildDevPlan(config, "/repo", {
      basePort: 8787,
      workerOptions: {
        "apps/api": { devArgs: ["--local", "--persist"] },
      },
    });

    story.then("the worker args include the custom devArgs");
    const apiWorker = plan.workers.find((w) => w.workerPath === "apps/api");
    expect(apiWorker?.args).toContain("--local");
    expect(apiWorker?.args).toContain("--persist");
  });

  it("throws when filter references an unknown worker", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api", "apps/worker"], {
      "apps/api": { BACKEND: "apps/worker" },
    });

    story.given("a filter for a worker path that is not declared in the config");

    story.then("building the plan fails fast instead of producing an empty dev session");
    expect(() =>
      buildDevPlan(config, "/repo", {
        basePort: 8787,
        filter: "apps/missing-worker",
      }),
    ).toThrow(/unknown worker/i);
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
      .mockResolvedValueOnce([9229, 9230]);

    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.doMock("./port-finder.js", () => ({ findAvailablePorts: findAvailablePortsMock }));

    const { startDev } = await import("./dev.js");

    const handle = await startDev(
      {
        workers: [
          { workerPath: "apps/api", cwd: "/repo/apps/api", port: 9000, args: [] },
          { workerPath: "apps/worker", cwd: "/repo/apps/worker", port: 9100, args: [] },
        ],
        ports: { "apps/api": 9000, "apps/worker": 9100 },
      },
      { output: () => {} },
    );

    story.then("the resolved dev ports still match the per-worker planned ports");
    expect(handle.ports).toEqual({
      "apps/api": 9000,
      "apps/worker": 9100,
    });
  });
});
