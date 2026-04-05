import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";

vi.mock("./auth.js", () => ({
  getWranglerEnv: vi.fn(() => ({
    CLOUDFLARE_API_TOKEN: "token-123",
  })),
  resolveAccountId: vi.fn(() => "acct-123"),
}));

import { KvStateProvider } from "./state.js";

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
