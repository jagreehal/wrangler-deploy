import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api.js";

describe("createApiClient", () => {
  it("signs GET requests with timestamp + signature headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = createApiClient(
      { endpoint: "https://guard.example.com/", signingKey: "secret" },
      { fetch: fetchMock as unknown as typeof fetch, now: () => new Date("2026-05-07T00:00:00.000Z") },
    );
    const result = await client.get<{ items: unknown[] }>("/api/breaches?account=a");
    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://guard.example.com/api/breaches?account=a",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-guard-timestamp": "2026-05-07T00:00:00.000Z",
          "x-guard-signature": expect.any(String),
        }),
      }),
    );
  });

  it("posts JSON body with content-type", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = createApiClient(
      { endpoint: "https://guard.example.com", signingKey: "secret" },
      { fetch: fetchMock as unknown as typeof fetch, now: () => new Date("2026-05-07T00:00:00.000Z") },
    );
    await client.post("/api/disarm", { accountId: "a", scriptName: "api", addedBy: "wug" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://guard.example.com/api/disarm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accountId: "a", scriptName: "api", addedBy: "wug" }),
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
  });

  it("throws with helpful message on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = createApiClient(
      { endpoint: "https://guard.example.com", signingKey: "secret" },
      { fetch: fetchMock as unknown as typeof fetch, now: () => new Date() },
    );
    await expect(client.get("/api/x")).rejects.toThrow(/401/);
  });
});
