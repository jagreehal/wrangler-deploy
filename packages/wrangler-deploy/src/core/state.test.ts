import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encrypt } from "./crypto.js";
import type { StageState } from "../types.js";

vi.mock("./auth.js", () => ({
  getWranglerEnv: vi.fn(() => ({
    CLOUDFLARE_API_TOKEN: "token-123",
  })),
  resolveAccountId: vi.fn(() => "acct-123"),
}));

import { D1StateProvider, KvStateProvider, LocalStateProvider, R2StateProvider } from "./state.js";

describe("KvStateProvider", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn() as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads JSON state from the KV values endpoint text body", async ({ task }) => {
    story.init(task);

    story.given("remote state stored as JSON text in Cloudflare KV");
    const stateJson = JSON.stringify({
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {},
      workers: {},
      secrets: {},
    });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      text: async () => stateJson,
      json: async () => {
        throw new Error("should not call json()");
      },
    } as unknown as Response);

    const provider = new KvStateProvider("/repo", "ns-123");

    story.when("the provider reads a stage from remote state");
    const state = await provider.read("staging");

    story.then("it should parse the JSON text body into stage state");
    expect(state?.stage).toBe("staging");
    expect(state?.resources).toEqual({});
  });
});

describe("LocalStateProvider with encryption", () => {
  it("reads back a state with decrypted Hyperdrive origin when password is provided", async ({ task }) => {
    story.init(task);

    story.given("a state file where hyperdrive origin is stored encrypted");
    const password = "test-password";
    const plainOrigin = "postgresql://user:pass@host/db";
    const encryptedOrigin = await encrypt(plainOrigin, password);

    const stateWithEncryptedOrigin: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "pg": {
          type: "hyperdrive",
          lifecycleStatus: "created",
          props: { type: "hyperdrive", name: "pg-staging", bindings: {} },
          output: { id: "hd-123", name: "pg-staging", origin: encryptedOrigin },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
    };

    // Write to disk directly (simulating prior encrypted write)
    const dir = mkdtempSync(join(tmpdir(), "wd-state-test-"));
    const provider = new LocalStateProvider(dir, password);
    const stateDir = join(dir, ".wrangler-deploy", "staging");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "state.json"),
      JSON.stringify(stateWithEncryptedOrigin, null, 2) + "\n",
    );

    story.when("the provider reads the state with the correct password");
    const read = await provider.read("staging");

    story.then("the hyperdrive origin is decrypted");
    const hyperOut = read?.resources["pg"]?.output as { origin: string } | undefined;
    expect(hyperOut?.origin).toBe(plainOrigin);
  });

  it("writes state with Hyperdrive origin encrypted", async ({ task }) => {
    story.init(task);

    story.given("a state with a plaintext Hyperdrive origin and a password");
    const dir = mkdtempSync(join(tmpdir(), "wd-state-test-"));
    const password = "test-password";
    const provider = new LocalStateProvider(dir, password);

    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "pg": {
          type: "hyperdrive",
          lifecycleStatus: "created",
          props: { type: "hyperdrive", name: "pg-staging", bindings: {} },
          output: { id: "hd-123", name: "pg-staging", origin: "postgresql://user:pass@host/db" },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
    };

    story.when("the provider writes the state");
    await provider.write("staging", state);

    story.then("the stored file has the origin encrypted");
    const raw = JSON.parse(readFileSync(join(dir, ".wrangler-deploy", "staging", "state.json"), "utf-8"));
    expect(raw.resources["pg"].output.origin).not.toBe("postgresql://user:pass@host/db");
    expect(raw.resources["pg"].output.origin).toMatch(/^v1:/);
  });
});

describe("D1StateProvider", () => {
  function envelope<T>(results: T[]) {
    return new Response(
      JSON.stringify({ success: true, result: [{ results }], errors: [] }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  function emptyOk() {
    return new Response(
      JSON.stringify({ success: true, result: [{ results: [] }], errors: [] }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn() as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects table names that aren't safe identifiers", () => {
    expect(() => new D1StateProvider("/repo", "db_1", "robert; DROP TABLE")).toThrow(
      /tableName must match/,
    );
  });

  it("bootstraps the schema on first write and upserts the row", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    vi.mocked(globalThis.fetch).mockImplementation(((_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { sql: string; params: unknown[] };
      calls.push({ sql: body.sql, params: body.params });
      return Promise.resolve(emptyOk());
    }) as typeof fetch);

    const provider = new D1StateProvider("/repo", "db_1");
    await provider.write("staging", {
      stage: "staging",
      createdAt: "x",
      updatedAt: "x",
      resources: {},
      workers: {},
      secrets: {},
    });

    expect(calls[0]?.sql).toMatch(/CREATE TABLE IF NOT EXISTS stage_state/);
    expect(calls[1]?.sql).toMatch(/INSERT INTO stage_state/);
    expect(calls[1]?.params[0]).toBe("staging");
  });

  it("read returns null for missing stages", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((() => Promise.resolve(emptyOk())) as typeof fetch);
    const provider = new D1StateProvider("/repo", "db_1");
    expect(await provider.read("ghost")).toBeNull();
  });

  it("read parses JSON state from the row", async () => {
    const stored: StageState = {
      stage: "staging",
      createdAt: "x",
      updatedAt: "x",
      resources: {},
      workers: {},
      secrets: {},
    };
    let calls = 0;
    vi.mocked(globalThis.fetch).mockImplementation((() => {
      calls += 1;
      // First call: ensureSchema; second: SELECT.
      if (calls === 1) return Promise.resolve(emptyOk());
      return Promise.resolve(envelope([{ state: JSON.stringify(stored) }]));
    }) as typeof fetch);

    const provider = new D1StateProvider("/repo", "db_1");
    const out = await provider.read("staging");
    expect(out).toEqual(stored);
  });

  it("list returns the stage column", async () => {
    let calls = 0;
    vi.mocked(globalThis.fetch).mockImplementation((() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(emptyOk());
      return Promise.resolve(envelope([{ stage: "dev" }, { stage: "prod" }]));
    }) as typeof fetch);
    const provider = new D1StateProvider("/repo", "db_1");
    expect(await provider.list()).toEqual(["dev", "prod"]);
  });

  it("propagates Cloudflare error envelopes", async () => {
    const errorBody = new Response(
      JSON.stringify({ success: false, result: [], errors: [{ message: "table not allowed" }] }),
      { headers: { "Content-Type": "application/json" } },
    );
    vi.mocked(globalThis.fetch).mockImplementation((() => Promise.resolve(errorBody)) as typeof fetch);
    const provider = new D1StateProvider("/repo", "db_1");
    await expect(provider.read("staging")).rejects.toThrow(/table not allowed/);
  });
});

describe("R2StateProvider", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn() as typeof fetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("read returns null on 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const provider = new R2StateProvider("/repo", "state-bucket");
    expect(await provider.read("staging")).toBeNull();
  });

  it("write puts the encrypted state to the prefixed key", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.mocked(globalThis.fetch).mockImplementation(((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string });
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof fetch);

    const provider = new R2StateProvider("/repo", "state-bucket");
    const state: StageState = {
      stage: "staging",
      createdAt: "x",
      updatedAt: "x",
      resources: {},
      workers: {},
      secrets: {},
    };
    await provider.write("staging", state);

    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toContain("/r2/buckets/state-bucket/objects/wrangler-deploy%2Fstaging");
    expect(JSON.parse(calls[0]?.body ?? "{}").stage).toBe("staging");
  });

  it("list strips the prefix from returned object keys", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            objects: [
              { key: "wrangler-deploy/dev" },
              { key: "wrangler-deploy/staging" },
              { key: "other/key" },
            ],
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new R2StateProvider("/repo", "state-bucket");
    expect(await provider.list()).toEqual(["dev", "staging"]);
  });

  it("delete tolerates 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("", { status: 404 }));
    const provider = new R2StateProvider("/repo", "state-bucket");
    await expect(provider.delete("ghost")).resolves.toBeUndefined();
  });

  it("propagates non-404 errors", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    const provider = new R2StateProvider("/repo", "state-bucket");
    await expect(provider.read("staging")).rejects.toThrow(/R2 get failed: 403/);
  });
});
