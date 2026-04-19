// src/signing.test.ts
import { describe, it, expect } from "vitest";
import { signRequest, verifyRequest } from "./signing.js";

describe("HMAC signing", () => {
  it("verify accepts a matching signature within skew", async () => {
    const key = "s3cret";
    const now = new Date("2026-04-17T12:00:00Z");
    const sig = await signRequest({ method: "GET", path: "/api/reports", timestamp: now.toISOString(), key });
    const ok = await verifyRequest({
      method: "GET",
      path: "/api/reports",
      timestamp: now.toISOString(),
      signature: sig,
      key,
      now,
      maxSkewSeconds: 300,
    });
    expect(ok).toBe(true);
  });

  it("rejects stale timestamp", async () => {
    const key = "s3cret";
    const stale = new Date("2026-04-17T11:00:00Z");
    const sig = await signRequest({ method: "GET", path: "/api/reports", timestamp: stale.toISOString(), key });
    const ok = await verifyRequest({
      method: "GET",
      path: "/api/reports",
      timestamp: stale.toISOString(),
      signature: sig,
      key,
      now: new Date("2026-04-17T12:00:00Z"),
      maxSkewSeconds: 300,
    });
    expect(ok).toBe(false);
  });

  it("rejects wrong signature", async () => {
    const ok = await verifyRequest({
      method: "GET",
      path: "/api/reports",
      timestamp: "2026-04-17T12:00:00Z",
      signature: "deadbeef",
      key: "s",
      now: new Date("2026-04-17T12:00:00Z"),
      maxSkewSeconds: 300,
    });
    expect(ok).toBe(false);
  });
});
