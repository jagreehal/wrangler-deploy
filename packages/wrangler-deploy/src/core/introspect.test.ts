import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import type { WranglerRunner } from "./wrangler-runner.js";
import type { FetchFn } from "./introspect.js";

vi.mock("./auth.js", () => ({
  resolveAccountId: vi.fn(() => "acct-123"),
}));

import { introspect } from "./introspect.js";

function createWranglerRunner(overrides?: Record<string, string>): WranglerRunner {
  const outputs: Record<string, string> = {
    "kv namespace list": "[]",
    "d1 list --json": "[]",
    "queues list": "[]",
    "r2 bucket list": "[]",
    "hyperdrive list": "[]",
    "vectorize list": "[]",
    ...overrides,
  };

  return {
    run(args: string[]) {
      const key = args.join(" ");
      const output = outputs[key];
      if (output === undefined) {
        throw new Error(`Unexpected wrangler command: ${key}`);
      }
      return output;
    },
  };
}

function createMockFetch(...responses: Array<{ result: unknown }>): FetchFn {
  const queue = [...responses];
  return (async () => {
    const next = queue.shift();
    return {
      ok: true,
      json: async () => next ?? { result: [] },
    };
  }) as unknown as FetchFn;
}

describe("introspect", () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = "token";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    vi.restoreAllMocks();
  });

  it("disambiguates logical resource names that normalize to the same key", async ({ task }) => {
    story.init(task);

    story.given("live resources whose names collapse to the same logical key");
    const wrangler = createWranglerRunner({
      "kv namespace list": JSON.stringify([
        { id: "kv-1", title: "cache-kv" },
        { id: "kv-2", title: "cache_kv" },
      ]),
    });

    story.when("introspect generates the config");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn: createMockFetch({ result: [] }) },
    );

    story.then("the generated config should not emit duplicate resource keys");
    const logicalNameOccurrences = result.configSource.match(/"cache-kv": \{/g) ?? [];
    expect(logicalNameOccurrences).toHaveLength(1);
  });

  it("does not emit duplicate logical keys for bound resources with colliding normalized names", async ({ task }) => {
    story.init(task);

    story.given("two workers each bound to a KV namespace whose names normalize identically");
    const wrangler = createWranglerRunner({
      "kv namespace list": JSON.stringify([
        { id: "kv-1", title: "cache-kv" },
        { id: "kv-2", title: "cache_kv" },
      ]),
    });

    const fetchFn = createMockFetch(
      { result: [{ id: "w1" }, { id: "w2" }] },
      { result: { bindings: [{ type: "kv_namespace", name: "CACHE", namespace_id: "kv-1" }] } },
      { result: { bindings: [{ type: "kv_namespace", name: "CACHE", namespace_id: "kv-2" }] } },
    );

    story.when("introspect generates the config");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn },
    );

    story.then("only one logical resource key should appear, with merged bindings");
    const logicalNameOccurrences = result.configSource.match(/"cache-kv": \{/g) ?? [];
    expect(logicalNameOccurrences).toHaveLength(1);
    expect(result.configSource).toContain(`"w1": "CACHE"`);
    expect(result.configSource).toContain(`"w2": "CACHE"`);
  });

  it("reconstructs DLQ relationships from queue consumer metadata", async ({ task }) => {
    story.init(task);

    story.given("a queue with a consumer and a configured dead-letter queue in live account state");
    const wrangler = createWranglerRunner({
      "queues list": JSON.stringify([
        {
          queue_id: "q-1",
          queue_name: "jobs",
          consumers: [{ script_name: "worker-a", dead_letter_queue: "jobs-dlq" }],
        },
        {
          queue_id: "q-2",
          queue_name: "jobs-dlq",
          consumers: [],
        },
      ]),
    });

    const fetchFn = createMockFetch(
      { result: [{ id: "worker-a" }] },
      { result: { bindings: [] } },
    );

    story.when("introspect generates config from the live account");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn },
    );

    story.then("the dead-letter queue relationship should be preserved in the config");
    expect(result.configSource).toContain(`"jobs-dlq": {`);
    expect(result.configSource).toContain(`deadLetterFor: "jobs"`);
  });

  it("keeps queue consumer workers declared when filtering by resource name", async ({ task }) => {
    story.init(task);

    story.given("a queue with a consumer worker discovered from resource metadata");
    const wrangler = createWranglerRunner({
      "queues list": JSON.stringify([
        {
          queue_id: "q-1",
          queue_name: "jobs",
          consumers: [{ script_name: "worker-a" }],
        },
      ]),
    });

    story.when("introspect runs with a filter matching the queue");
    const result = await introspect(
      { filter: "jobs" },
      { rootDir: "/repo", wrangler, fetchFn: createMockFetch({ result: [] }) },
    );

    story.then("the consumer worker should be in the workers array");
    expect(result.configSource).toContain(`"worker-a",`);
  });

  it("merges producer and consumer roles for the same worker on one queue", async ({ task }) => {
    story.init(task);

    story.given("a worker that both produces to and consumes from the same queue");
    const wrangler = createWranglerRunner({
      "queues list": JSON.stringify([
        {
          queue_id: "q-1",
          queue_name: "outbox",
          consumers: [{ script_name: "worker-a" }],
        },
      ]),
    });

    const fetchFn = createMockFetch(
      { result: [{ id: "worker-a" }] },
      { result: { bindings: [{ type: "queue", name: "OUTBOX", queue_name: "outbox" }] } },
    );

    story.when("introspect generates the config");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn },
    );

    story.then("only one binding entry should exist for that worker, with both roles merged");
    const workerBindingOccurrences = result.configSource.match(/"worker-a":/g) ?? [];
    expect(workerBindingOccurrences).toHaveLength(1);
    expect(result.configSource).toContain(`"worker-a": { producer: "OUTBOX", consumer: true }`);
  });

  it("does not drop resources when different resource types normalize to the same logical key", async ({ task }) => {
    story.init(task);

    story.given("a KV namespace and a D1 database whose names normalize to the same key");
    const wrangler = createWranglerRunner({
      "kv namespace list": JSON.stringify([{ id: "kv-1", title: "cache-kv" }]),
      "d1 list --json": JSON.stringify([{ uuid: "db-1", name: "cache_kv" }]),
    });

    story.when("introspect generates the config");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn: createMockFetch({ result: [] }) },
    );

    story.then("both resources should still be represented in the manifest");
    const kvCount = (result.configSource.match(/type: "kv"/g) ?? []).length;
    const d1Count = (result.configSource.match(/type: "d1"/g) ?? []).length;
    expect(kvCount).toBe(1);
    expect(d1Count).toBe(1);
  });

  it("keeps same-type merged bindings even when a cross-type collision forces disambiguation", async ({ task }) => {
    story.init(task);

    story.given("two KV namespaces and one D1 database that all normalize to the same base key");
    const wrangler = createWranglerRunner({
      "kv namespace list": JSON.stringify([
        { id: "kv-1", title: "cache-kv" },
        { id: "kv-2", title: "cache_kv" },
      ]),
      "d1 list --json": JSON.stringify([{ uuid: "db-1", name: "cache kv" }]),
    });

    const fetchFn = createMockFetch(
      { result: [{ id: "w1" }, { id: "w2" }] },
      { result: { bindings: [{ type: "kv_namespace", name: "CACHE_ONE", namespace_id: "kv-1" }] } },
      { result: { bindings: [{ type: "kv_namespace", name: "CACHE_TWO", namespace_id: "kv-2" }] } },
    );

    story.when("introspect generates disambiguated resource names");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn },
    );

    story.then("the disambiguated KV resource should still include both worker bindings");
    expect(result.configSource).toContain(`"cache-kv-kv": {`);
    expect(result.configSource).toContain(`"w1": "CACHE_ONE"`);
    expect(result.configSource).toContain(`"w2": "CACHE_TWO"`);
  });

  it("avoids collisions between disambiguated names and real resource names", async ({ task }) => {
    story.init(task);

    story.given("a cross-type collision whose disambiguated name matches a real resource name");
    const wrangler = createWranglerRunner({
      "d1 list --json": JSON.stringify([{ uuid: "db-1", name: "cache kv" }]),
      "kv namespace list": JSON.stringify([
        { id: "kv-1", title: "cache kv" },
        { id: "kv-2", title: "cache-kv-kv" },
      ]),
    });

    const fetchFn = createMockFetch(
      { result: [{ id: "w1" }, { id: "w2" }] },
      { result: { bindings: [{ type: "kv_namespace", name: "CACHE_ONE", namespace_id: "kv-1" }] } },
      { result: { bindings: [{ type: "kv_namespace", name: "CACHE_TWO", namespace_id: "kv-2" }] } },
    );

    story.when("introspect generates resource names");
    const result = await introspect(
      {},
      { rootDir: "/repo", wrangler, fetchFn },
    );

    story.then("it should not emit duplicate object keys after disambiguation");
    const occurrences = result.configSource.match(/"cache-kv-kv": \{/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});
