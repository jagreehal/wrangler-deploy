import { describe, expect, it } from "vitest";
import type { CfStageConfig } from "../types.js";
import { applyRemoteBindingsToOverride, computeRemoteBindings } from "./dev.js";

function makeConfig(): CfStageConfig {
  return {
    version: 1,
    workers: ["apps/api", "apps/worker"],
    resources: {
      cache: {
        type: "kv",
        bindings: { "apps/api": "CACHE", "apps/worker": "CACHE" },
        dev: { remote: true },
      },
      db: {
        type: "d1",
        bindings: { "apps/api": "DB" },
      },
      pg: {
        type: "hyperdrive",
        bindings: { "apps/api": "PG" },
        dev: { remote: true },
      },
      ai: {
        type: "vectorize",
        bindings: { "apps/api": "AI" },
        dev: { remote: true },
      },
      tasks: {
        type: "queue",
        bindings: {
          "apps/api": { producer: "TASKS" },
          "apps/worker": { consumer: true },
        },
        dev: { remote: true },
      },
    },
  } as unknown as CfStageConfig;
}

describe("computeRemoteBindings", () => {
  it("groups remote bindings by worker, ignoring resources without dev.remote", () => {
    const result = computeRemoteBindings(makeConfig());
    const apiBindings = result.get("apps/api") ?? [];
    expect(apiBindings.map((b) => b.binding).sort()).toEqual(["AI", "CACHE", "PG", "TASKS"]);

    const workerBindings = result.get("apps/worker") ?? [];
    // Only CACHE — db isn't remote, queue consumer has no env binding name.
    expect(workerBindings.map((b) => b.binding)).toEqual(["CACHE"]);
  });

  it("returns an empty map when no resource is dev.remote", () => {
    const config = makeConfig();
    for (const resource of Object.values(config.resources)) delete resource.dev;
    expect(computeRemoteBindings(config).size).toBe(0);
  });
});

describe("applyRemoteBindingsToOverride", () => {
  it("places each binding into the correct wrangler section", () => {
    const out = applyRemoteBindingsToOverride(
      { extends: "../../wrangler.jsonc" },
      [
        { binding: "CACHE", type: "kv" },
        { binding: "DB", type: "d1" },
        { binding: "UPLOADS", type: "r2" },
        { binding: "PG", type: "hyperdrive" },
        { binding: "AI", type: "vectorize" },
        { binding: "TASKS", type: "queue" },
      ],
    );
    expect(out.kv_namespaces).toEqual([{ binding: "CACHE", experimental_remote: true }]);
    expect(out.d1_databases).toEqual([{ binding: "DB", experimental_remote: true }]);
    expect(out.r2_buckets).toEqual([{ binding: "UPLOADS", experimental_remote: true }]);
    expect(out.hyperdrive).toEqual([{ binding: "PG", experimental_remote: true }]);
    expect(out.vectorize).toEqual([{ binding: "AI", experimental_remote: true }]);
    expect(out.queues?.producers).toEqual([{ binding: "TASKS", experimental_remote: true }]);
  });

  it("preserves the extends and services fields from the base override", () => {
    const out = applyRemoteBindingsToOverride(
      {
        extends: "../base.jsonc",
        services: [{ binding: "BACKEND", service: "deployed-worker-staging" }],
      },
      [{ binding: "CACHE", type: "kv" }],
    );
    expect(out.extends).toBe("../base.jsonc");
    expect(out.services).toEqual([{ binding: "BACKEND", service: "deployed-worker-staging" }]);
    expect(out.kv_namespaces).toEqual([{ binding: "CACHE", experimental_remote: true }]);
  });

  it("ignores DNS resources", () => {
    const out = applyRemoteBindingsToOverride({}, [{ binding: "ZONE", type: "dns" }]);
    expect(out).toEqual({});
  });
});
