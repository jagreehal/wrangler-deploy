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

import { KvStateProvider, LocalStateProvider } from "./state.js";

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
