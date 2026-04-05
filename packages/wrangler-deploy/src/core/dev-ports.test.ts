import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { assignPorts } from "./dev-ports.js";
import type { CfStageConfig } from "../types.js";

function makeConfig(workers: string[], serviceBindings?: Record<string, Record<string, string>>): CfStageConfig {
  return {
    version: 1,
    workers,
    resources: {},
    serviceBindings,
  };
}

describe("assignPorts", () => {
  it("assigns unique ports >= basePort to all workers", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api", "apps/worker", "apps/auth"]);

    story.given("a config with three workers and basePort 8787");
    const ports = assignPorts(config, 8787);

    story.then("every worker gets a unique port starting at 8787");
    const assigned = Object.values(ports);
    expect(assigned).toHaveLength(3);
    expect(new Set(assigned).size).toBe(3);
    for (const port of assigned) {
      expect(port).toBeGreaterThanOrEqual(8787);
    }
  });

  it("respects explicit port overrides", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api", "apps/worker"]);
    const overrides = { "apps/api": 9000 };

    story.given("a config with an explicit override for apps/api");
    const ports = assignPorts(config, 8787, overrides);

    story.then("apps/api uses the overridden port 9000");
    expect(ports["apps/api"]).toBe(9000);
  });

  it("skips overridden ports when auto-assigning remaining workers", ({ task }) => {
    story.init(task);

    const config = makeConfig(["apps/api", "apps/worker", "apps/auth"]);
    const overrides = { "apps/worker": 8788 };

    story.given("apps/worker is overridden to 8788, basePort is 8787");
    const ports = assignPorts(config, 8787, overrides);

    story.then("apps/worker uses 8788, other workers skip 8788");
    expect(ports["apps/worker"]).toBe(8788);
    const autoAssigned = Object.entries(ports)
      .filter(([k]) => k !== "apps/worker")
      .map(([, v]) => v);
    expect(autoAssigned).not.toContain(8788);
    expect(new Set(Object.values(ports)).size).toBe(3);
  });
});
