import { describe, it, expect, vi } from "vitest";
import { runListApprovals, runApprove, runReject } from "./approvals.js";

describe("runListApprovals", () => {
  it("GETs /api/approvals with account in query", async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ items: [
        { id: "a1", scriptName: "api", accountId: "a", breachKey: "a:api:requests", createdAt: "t", expiresAt: "t2", ruleId: "r1", breachType: "requests", actualValue: 600_000, limitValue: 500_000 },
      ] }),
    } as unknown as { get: <T>(path: string, deps: unknown) => Promise<T> };
    const rows = await runListApprovals({ accountId: "a" }, { client });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scriptName).toBe("api");
  });
});

describe("runApprove", () => {
  it("POSTs /api/approvals/:id/approve", async () => {
    const client = {
      post: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as { post: <T>(path: string, body: unknown, deps: unknown) => Promise<T> };
    const result = await runApprove({ id: "a1", accountId: "acct", decidedBy: "cli:jag" }, { client });
    expect(result.ok).toBe(true);
    const call = (client.post as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe("/api/approvals/a1/approve");
    expect(call[1]).toEqual({ accountId: "acct", decidedBy: "cli:jag" });
  });
});

describe("runReject", () => {
  it("POSTs /api/approvals/:id/reject", async () => {
    const client = {
      post: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as { post: <T>(path: string, body: unknown, deps: unknown) => Promise<T> };
    const result = await runReject({ id: "a1", accountId: "acct", decidedBy: "cli:jag" }, { client });
    expect(result.ok).toBe(true);
    const call = (client.post as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).toEqual({ accountId: "acct", decidedBy: "cli:jag" });
  });
});
