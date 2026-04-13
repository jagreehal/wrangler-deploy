import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import type { StageState } from "../types.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { detectDrift } from "./drift.js";

const mockState: StageState = {
  stage: "staging",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  resources: {
    "cache-kv": {
      type: "kv",
      lifecycleStatus: "created",
      props: { type: "kv", name: "cache-kv-staging", bindings: {} },
      output: { id: "abc123", title: "cache-kv-staging" },
      source: "managed",
    },
    "outbox": {
      type: "queue",
      lifecycleStatus: "created",
      props: { type: "queue", name: "outbox-staging", bindings: {} },
      output: { name: "outbox-staging" },
      source: "managed",
    },
    "payments-db": {
      type: "d1",
      lifecycleStatus: "created",
      props: { type: "d1", name: "payments-db-staging", bindings: {} },
      output: { id: "db-123", name: "payments-db-staging" },
      source: "managed",
    },
  },
  workers: {},
  secrets: {},
};

describe("detectDrift", () => {
  it("reports in-sync when resources exist", ({ task }) => {
    story.init(task);

    story.given("a state with KV, queue, and D1 resources");
    story.and("the Cloudflare API confirms they exist");
    const wrangler: WranglerRunner = {
      run: vi.fn().mockImplementation((args: string[]) => {
        const cmd = args.join(" ");
        if (cmd.includes("kv namespace list")) {
          return JSON.stringify([{ id: "abc123", title: "cache-kv-staging" }]);
        }
        if (cmd.includes("queues list")) {
          return JSON.stringify([{ queue_name: "outbox-staging" }]);
        }
        if (cmd.includes("d1 list")) {
          return JSON.stringify([{ uuid: "db-123", name: "payments-db-staging" }]);
        }
        return "[]";
      }),
    };

    story.when("drift detection runs");
    const results = detectDrift({ state: mockState }, { rootDir: "/repo", wrangler });

    story.then("all resources report in-sync");
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe("in-sync");
    expect(results[1]?.status).toBe("in-sync");
    expect(results[2]?.status).toBe("in-sync");
  });

  it("reports orphaned when resource not found in API", ({ task }) => {
    story.init(task);

    story.given("a state with KV and queue resources");
    story.and("the Cloudflare API returns empty results");
    const wrangler: WranglerRunner = {
      run: vi.fn().mockReturnValue("[]"),
    };

    story.when("drift detection runs");
    const results = detectDrift({ state: mockState }, { rootDir: "/repo", wrangler });

    story.then("all resources report orphaned");
    expect(results[0]?.status).toBe("orphaned");
    expect(results[1]?.status).toBe("orphaned");
  });

  it("does not report unsupported resource types as in-sync by default", ({ task }) => {
    story.init(task);

    story.given("a state containing a D1 database");
    story.and("the live listing is empty");
    const wrangler: WranglerRunner = {
      run: vi.fn().mockReturnValue("[]"),
    };

    story.when("drift detection runs");
    const results = detectDrift({ state: mockState }, { rootDir: "/repo", wrangler });

    story.then("the D1 resource should not be treated as in-sync");
    const d1Result = results.find((r) => r.resource === "payments-db");
    expect(d1Result?.status).toBe("orphaned");
  });

  it("does not treat similarly named queues as exact matches", ({ task }) => {
    story.init(task);

    story.given("a state containing a queue named outbox-staging");
    story.and("the live list only contains a different queue whose name contains that string");
    const wrangler: WranglerRunner = {
      run: vi.fn().mockImplementation((args: string[]) => {
        const cmd = args.join(" ");
        if (cmd.includes("queues list")) {
          return JSON.stringify([{ queue_name: "outbox-staging-copy" }]);
        }
        return "[]";
      }),
    };

    story.when("drift detection runs");
    const results = detectDrift({ state: mockState }, { rootDir: "/repo", wrangler });

    story.then("the queue should not be reported as in-sync");
    const queueResult = results.find((r) => r.resource === "outbox");
    expect(queueResult?.status).toBe("orphaned");
  });

  it("does not treat similarly named D1 databases as exact matches", ({ task }) => {
    story.init(task);

    story.given("a state containing a D1 database named payments-db-staging");
    story.and("the live list only contains a different database whose name contains that string");
    const wrangler: WranglerRunner = {
      run: vi.fn().mockImplementation((args: string[]) => {
        const cmd = args.join(" ");
        if (cmd.includes("d1 list")) {
          return JSON.stringify([{ uuid: "db-other", name: "payments-db-staging-copy" }]);
        }
        return "[]";
      }),
    };

    story.when("drift detection runs");
    const results = detectDrift({ state: mockState }, { rootDir: "/repo", wrangler });

    story.then("the D1 resource should not be reported as in-sync");
    const d1Result = results.find((r) => r.resource === "payments-db");
    expect(d1Result?.status).toBe("orphaned");
  });
});
