import { describe, it, expect, vi } from "vitest";
import { cfFetch } from "./api.js";

describe("cfFetch", () => {
  it("sends bearer token and parses JSON", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { ok: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const out = await cfFetch<{ ok: number }>(
      { path: "/x" },
      { fetch: fetch as unknown as typeof globalThis.fetch, token: "T" }
    );
    expect(out.ok).toBe(1);
    expect(fetch.mock.calls.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [, init] = (fetch.mock.calls[0] as any) || [];
    expect((init as { headers: Record<string, string> }).headers["authorization"]).toBe(
      "Bearer T"
    );
  });

  it("throws on 4xx", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(
      cfFetch({ path: "/x" }, { fetch: fetch as unknown as typeof globalThis.fetch, token: "T" })
    ).rejects.toThrow(/403/);
  });
});
