// src/cloudflare/routes.test.ts
import { describe, it, expect, vi } from "vitest";
import { detachRoutesForWorker } from "./routes.js";

function respond(json: unknown, status = 200) {
  return new Response(JSON.stringify({ result: json }), { status, headers: { "content-type": "application/json" } });
}

describe("detachRoutesForWorker", () => {
  it("deletes only routes matching scriptName", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return respond({}, 200);
      if (url.endsWith("/workers/routes")) {
        return respond([
          { id: "r1", pattern: "a.com/*", script: "api" },
          { id: "r2", pattern: "b.com/*", script: "other" },
        ]);
      }
      throw new Error(`unexpected: ${url}`);
    });
    const out = await detachRoutesForWorker(
      { scriptName: "api", zones: [{ zoneId: "z1" }] },
      { fetch: fetch as unknown as typeof globalThis.fetch, token: "T" }
    );
    expect(out).toEqual([{ zoneId: "z1", routeId: "r1", pattern: "a.com/*" }]);
  });
});
