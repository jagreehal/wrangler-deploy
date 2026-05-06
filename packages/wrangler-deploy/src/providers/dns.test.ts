import { describe, expect, it, vi } from "vitest";
import {
  createDnsRecord,
  deleteDnsRecord,
  findZoneId,
  listDnsRecords,
  reconcileDnsRecords,
  updateDnsRecord,
  type DnsRecord,
} from "./dns.js";

function envelope<T>(result: T, success = true) {
  return new Response(JSON.stringify({ success, result, errors: [] }), {
    headers: { "Content-Type": "application/json" },
  });
}

function errorEnvelope(code: number, message: string) {
  return new Response(
    JSON.stringify({ success: false, result: null, errors: [{ code, message }] }),
    { headers: { "Content-Type": "application/json" } },
  );
}

describe("findZoneId", () => {
  it("returns the zone id matching the requested name", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      envelope([{ id: "zone_42", name: "example.com" }]),
    );
    const id = await findZoneId("example.com", { apiToken: "tok" }, fetchFn as never);
    expect(id).toBe("zone_42");
    expect((fetchFn.mock.calls[0]?.[0] as string)).toContain("name=example.com");
  });

  it("throws when no matching zone is returned", async () => {
    const fetchFn = vi.fn().mockResolvedValue(envelope([]));
    await expect(
      findZoneId("example.com", { apiToken: "tok" }, fetchFn as never),
    ).rejects.toThrow(/zone not found: example.com/);
  });

  it("propagates Cloudflare error envelopes", async () => {
    const fetchFn = vi.fn().mockResolvedValue(errorEnvelope(7003, "expired"));
    await expect(
      findZoneId("example.com", { apiToken: "tok" }, fetchFn as never),
    ).rejects.toThrow(/\[7003\] expired/);
  });
});

describe("CRUD helpers", () => {
  it("listDnsRecords parses paginated response", async () => {
    const records: DnsRecord[] = [
      { id: "r1", name: "api.example.com", type: "A", content: "1.2.3.4" },
    ];
    const fetchFn = vi.fn().mockResolvedValue(envelope(records));
    const out = await listDnsRecords("zone_1", { apiToken: "tok" }, fetchFn as never);
    expect(out).toEqual(records);
  });

  it("createDnsRecord posts the body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      envelope({ id: "new", name: "api.example.com", type: "A", content: "1.2.3.4" }),
    );
    const out = await createDnsRecord(
      "zone_1",
      { type: "A", name: "api.example.com", content: "1.2.3.4" },
      { apiToken: "tok" },
      fetchFn as never,
    );
    expect(out.id).toBe("new");
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).name).toBe("api.example.com");
  });

  it("updateDnsRecord uses PUT with the right ID", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      envelope({ id: "r1", name: "api.example.com", type: "A", content: "5.6.7.8" }),
    );
    await updateDnsRecord(
      "zone_1",
      "r1",
      { type: "A", name: "api.example.com", content: "5.6.7.8" },
      { apiToken: "tok" },
      fetchFn as never,
    );
    const url = fetchFn.mock.calls[0]?.[0] as string;
    expect(url).toContain("/zones/zone_1/dns_records/r1");
    expect((fetchFn.mock.calls[0]?.[1] as RequestInit).method).toBe("PUT");
  });

  it("deleteDnsRecord ignores 404", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(
      deleteDnsRecord("zone_1", "r1", { apiToken: "tok" }, fetchFn as never),
    ).resolves.toBeUndefined();
  });
});

describe("reconcileDnsRecords", () => {
  it("creates missing records, updates drifted ones, leaves matched untouched", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchFn = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.endsWith("/dns_records?per_page=1000")) {
        return envelope([
          // matched
          { id: "match", name: "ok.example.com", type: "A", content: "1.1.1.1" },
          // drifted (content changed)
          { id: "drift", name: "drift.example.com", type: "A", content: "1.1.1.1" },
        ]);
      }
      if (url.endsWith("/dns_records") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        return envelope({ id: "new", ...body });
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return envelope({ id: "drift", ...body });
      }
      throw new Error(`unexpected: ${url}`);
    });

    const result = await reconcileDnsRecords(
      "zone_1",
      [
        { type: "A", name: "ok.example.com", content: "1.1.1.1" },
        { type: "A", name: "drift.example.com", content: "9.9.9.9" },
        { type: "A", name: "new.example.com", content: "8.8.8.8" },
      ],
      { apiToken: "tok" },
      fetchFn as never,
    );

    expect(result.map((r) => r.id)).toEqual(["match", "drift", "new"]);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });
});
