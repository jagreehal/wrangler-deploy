// src/cloudflare/domains.test.ts
import { describe, it, expect, vi } from "vitest";
import { detachDomainsForWorker } from "./domains.js";

function respond(json: unknown, status = 200) {
  return new Response(JSON.stringify({ result: json }), { status, headers: { "content-type": "application/json" } });
}

describe("detachDomainsForWorker", () => {
  it("deletes matching service hostnames", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return respond({}, 200);
      return respond([
        { id: "d1", hostname: "api.example.com", service: "api" },
        { id: "d2", hostname: "other.example.com", service: "other" },
      ]);
    });
    const out = await detachDomainsForWorker(
      { accountId: "a", scriptName: "api" },
      { fetch: fetch as unknown as typeof globalThis.fetch, token: "T" }
    );
    expect(out).toEqual(["api.example.com"]);
  });
});
