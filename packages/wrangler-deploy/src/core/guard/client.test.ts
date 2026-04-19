import { describe, it, expect, vi } from "vitest";
import { createGuardClient, type GuardClientConfig, type GuardClientDeps } from "./client.js";

function mkDeps(): GuardClientDeps {
  return {
    now: () => new Date("2026-04-17T12:00:00Z"),
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ reports: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof globalThis.fetch,
  };
}

const config: GuardClientConfig = {
  endpoint: "https://guard.example.workers.dev",
  signingKey: "secret",
};

describe("guardClient", () => {
  it("GET signs the request with method + path + timestamp", async () => {
    const deps = mkDeps();
    const client = createGuardClient(config);
    await client.get<{ reports: unknown[] }>("/api/reports?account=a", deps);
    const call = (deps.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe("https://guard.example.workers.dev/api/reports?account=a");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-guard-timestamp"]).toBe("2026-04-17T12:00:00.000Z");
    expect(typeof headers["x-guard-signature"]).toBe("string");
    expect(headers["x-guard-signature"]!.length).toBeGreaterThan(0);
  });

  it("throws with HTTP status on non-2xx", async () => {
    const deps = {
      now: () => new Date("2026-04-17T12:00:00Z"),
      fetch: vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof globalThis.fetch,
    };
    const client = createGuardClient(config);
    await expect(client.get("/api/reports?account=a", deps)).rejects.toThrow(/401/);
  });

  it("returns parsed JSON on 2xx", async () => {
    const deps = {
      now: () => new Date("2026-04-17T12:00:00Z"),
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ breaches: [{ id: "x" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ) as unknown as typeof globalThis.fetch,
    };
    const client = createGuardClient(config);
    const out = await client.get<{ breaches: Array<{ id: string }> }>("/api/breaches?account=a", deps);
    expect(out.breaches[0]?.id).toBe("x");
  });

  it("POST signs with method POST and sends JSON body", async () => {
    const deps: GuardClientDeps = {
      now: () => new Date("2026-04-17T12:00:00Z"),
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
      ) as unknown as typeof globalThis.fetch,
    };
    const client = createGuardClient(config);
    const out = await client.post<{ ok: boolean }>("/api/disarm", { accountId: "a", scriptName: "api" }, deps);
    expect(out.ok).toBe(true);
    const call = (deps.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ accountId: "a", scriptName: "api" });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-guard-signature"]!.length).toBeGreaterThan(0);
  });

  it("DELETE signs with method DELETE and sends JSON body", async () => {
    const deps: GuardClientDeps = {
      now: () => new Date("2026-04-17T12:00:00Z"),
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
      ) as unknown as typeof globalThis.fetch,
    };
    const client = createGuardClient(config);
    const out = await client.delete<{ ok: boolean }>("/api/disarm", { accountId: "a", scriptName: "api" }, deps);
    expect(out.ok).toBe(true);
    const call = (deps.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const [, init] = call as [string, RequestInit];
    expect(init.method).toBe("DELETE");
  });
});
