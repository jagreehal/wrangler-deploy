import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { runDoctor } from "./doctor.js";
import type { DoctorDeps } from "./doctor.js";
import type { CfStageConfig } from "../types.js";

const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/batch-workflow"],
  resources: {},
};

const healthyDeps: DoctorDeps = {
  wranglerVersion: () => "3.22.0",
  wranglerAuth: () => "logged in as test@example.com",
  workerExists: () => true,
  configErrors: [],
};

describe("runDoctor", () => {
  it("all checks pass when system is healthy", ({ task }) => {
    story.init(task);
    story.given("wrangler is installed, auth is valid, all worker paths exist, config is valid");

    const checks = runDoctor(config, healthyDeps);

    story.then("all checks have status pass");
    expect(checks.every((c) => c.status === "pass")).toBe(true);

    story.then("wrangler version is reported");
    const versionCheck = checks.find((c) => c.name === "wrangler installed");
    expect(versionCheck?.message).toContain("3.22.0");
  });

  it("fails when wrangler is not installed", ({ task }) => {
    story.init(task);
    story.given("wranglerVersion throws an error");

    const deps: DoctorDeps = {
      ...healthyDeps,
      wranglerVersion: () => { throw new Error("command not found: wrangler"); },
    };
    const checks = runDoctor(config, deps);

    story.then("the wrangler installed check fails");
    const versionCheck = checks.find((c) => c.name === "wrangler installed");
    expect(versionCheck?.status).toBe("fail");
    expect(versionCheck?.details).toContain("command not found");
  });

  it("fails when worker paths are missing", ({ task }) => {
    story.init(task);
    story.given("workerExists returns false for all paths");

    const deps: DoctorDeps = {
      ...healthyDeps,
      workerExists: () => false,
    };
    const checks = runDoctor(config, deps);

    story.then("worker path checks fail");
    const workerChecks = checks.filter((c) => c.name.startsWith("worker path:"));
    expect(workerChecks.every((c) => c.status === "fail")).toBe(true);
  });

  it("fails when config has errors", ({ task }) => {
    story.init(task);
    story.given("configErrors contains validation errors");

    const deps: DoctorDeps = {
      ...healthyDeps,
      configErrors: ['Resource "cache-kv" has binding for unknown worker "apps/missing"'],
    };
    const checks = runDoctor(config, deps);

    story.then("a config error check is present with fail status");
    const configCheck = checks.find((c) => c.name === "config error");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.message).toContain("apps/missing");
  });
});
