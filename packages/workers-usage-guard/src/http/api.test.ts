// src/http/api.test.ts
import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { handleApiRequest, type ApiDeps } from "./api.js";
import { signRequest } from "./signing.js";
import { stubs } from "../test-utils/stubs.js";

function mkDeps(): ApiDeps {
  const d = mock<ApiDeps>() as unknown as Record<string, unknown>;
  d.now = () => new Date("2026-04-17T12:00:00Z");
  d.signingKey = "s3cret";
  d.listReports = vi.fn().mockResolvedValue([stubs.usageReport()]);
  d.listBreaches = vi.fn().mockResolvedValue([stubs.breachForensic()]);
  d.listSnapshots = vi.fn().mockResolvedValue([stubs.usageSnapshot()]);
  d.healthInfo = vi.fn().mockResolvedValue({ lastCheck: "t1", lastReport: "t2" });
  d.addRuntimeProtection = vi.fn().mockResolvedValue(undefined) as unknown as ApiDeps["addRuntimeProtection"];
  d.removeRuntimeProtection = vi.fn().mockResolvedValue(undefined) as unknown as ApiDeps["removeRuntimeProtection"];
  d.listRuntimeProtectedOn = vi.fn().mockResolvedValue([]) as unknown as ApiDeps["listRuntimeProtectedOn"];
  d.listPendingApprovals = vi.fn().mockResolvedValue([]) as unknown as ApiDeps["listPendingApprovals"];
  d.decideApproval = vi.fn().mockResolvedValue({ updated: true }) as unknown as ApiDeps["decideApproval"];
  return d as unknown as ApiDeps;
}

async function signedFetch(path: string, deps: ApiDeps): Promise<Request> {
  const ts = deps.now().toISOString();
  const sig = await signRequest({ method: "GET", path, timestamp: ts, key: deps.signingKey });
  return new Request(`https://guard.example.com${path}`, {
    method: "GET",
    headers: { "x-guard-timestamp": ts, "x-guard-signature": sig },
  });
}

describe("HTTP API", () => {
  it("health is unsigned and returns ok", async () => {
    const d = mkDeps();
    const res = await handleApiRequest(
      { request: new Request("https://guard.example.com/api/health") },
      d
    );
    expect(res.status).toBe(200);
  });

  it("signed /api/reports returns reports", async () => {
    const d = mkDeps();
    const req = await signedFetch("/api/reports?account=a&from=x&to=y", d);
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reports: unknown[] };
    expect(Array.isArray(body.reports)).toBe(true);
  });

  it("rejects missing signature", async () => {
    const d = mkDeps();
    const res = await handleApiRequest(
      { request: new Request("https://guard.example.com/api/breaches?account=a") },
      d
    );
    expect(res.status).toBe(401);
  });

  it("signed POST /api/disarm inserts via addRuntimeProtection", async () => {
    const d = mkDeps();
    d.addRuntimeProtection = vi.fn().mockResolvedValue(undefined) as unknown as ApiDeps["addRuntimeProtection"];
    const ts = d.now().toISOString();
    const path = "/api/disarm";
    const sig = await signRequest({ method: "POST", path, timestamp: ts, key: d.signingKey });
    const req = new Request("https://guard.example.com" + path, {
      method: "POST",
      headers: { "x-guard-timestamp": ts, "x-guard-signature": sig, "content-type": "application/json" },
      body: JSON.stringify({ accountId: "a", scriptName: "api", addedBy: "cli:jag", reason: "oncall" }),
    });
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(200);
    expect(d.addRuntimeProtection).toHaveBeenCalledWith({
      accountId: "a",
      scriptName: "api",
      addedBy: "cli:jag",
      reason: "oncall",
    });
  });

  it("signed DELETE /api/disarm calls removeRuntimeProtection", async () => {
    const d = mkDeps();
    d.removeRuntimeProtection = vi.fn().mockResolvedValue(undefined) as unknown as ApiDeps["removeRuntimeProtection"];
    const ts = d.now().toISOString();
    const path = "/api/disarm";
    const sig = await signRequest({ method: "DELETE", path, timestamp: ts, key: d.signingKey });
    const req = new Request("https://guard.example.com" + path, {
      method: "DELETE",
      headers: { "x-guard-timestamp": ts, "x-guard-signature": sig, "content-type": "application/json" },
      body: JSON.stringify({ accountId: "a", scriptName: "api" }),
    });
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(200);
    expect(d.removeRuntimeProtection).toHaveBeenCalledWith({
      accountId: "a",
      scriptName: "api",
    });
  });

  it("unsigned POST /api/disarm returns 401", async () => {
    const d = mkDeps();
    const req = new Request("https://guard.example.com/api/disarm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "a", scriptName: "api" }),
    });
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(401);
  });

  it("signed GET /api/runtime-protected returns list of runtime-protected entries", async () => {
    const d = mkDeps();
    d.listRuntimeProtectedOn = vi.fn().mockResolvedValue([
      { accountId: "a", scriptName: "api", addedAt: "t", addedBy: "cli:jag", reason: "oncall" },
    ]) as unknown as ApiDeps["listRuntimeProtectedOn"];
    const req = await signedFetch("/api/runtime-protected?account=a", d);
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it("signed GET /api/approvals returns pending approvals", async () => {
    const d = mkDeps();
    d.listPendingApprovals = vi.fn().mockResolvedValue([
      {
        id: "appr-1",
        accountId: "a",
        scriptName: "api",
        breachKey: "a:api:requests",
        workflowInstanceId: "wf-1",
        createdAt: "t1",
        expiresAt: "t2",
        status: "pending",
        decidedAt: null,
        decidedBy: null,
        ruleId: "r1",
        breachType: "requests",
        actualValue: 600_000,
        limitValue: 500_000,
      },
    ]) as unknown as ApiDeps["listPendingApprovals"];
    const req = await signedFetch("/api/approvals?account=a", d);
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it("signed POST /api/approvals/:id/approve requires accountId", async () => {
    const d = mkDeps();
    const ts = d.now().toISOString();
    const path = "/api/approvals/appr-1/approve";
    const sig = await signRequest({ method: "POST", path, timestamp: ts, key: d.signingKey });
    const req = new Request("https://guard.example.com" + path, {
      method: "POST",
      headers: { "x-guard-timestamp": ts, "x-guard-signature": sig, "content-type": "application/json" },
      body: JSON.stringify({ decidedBy: "cli:jag" }),
    });
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(400);
  });

  it("signed POST /api/approvals/:id/reject calls decideApproval", async () => {
    const d = mkDeps();
    const ts = d.now().toISOString();
    const path = "/api/approvals/appr-1/reject";
    const sig = await signRequest({ method: "POST", path, timestamp: ts, key: d.signingKey });
    const req = new Request("https://guard.example.com" + path, {
      method: "POST",
      headers: { "x-guard-timestamp": ts, "x-guard-signature": sig, "content-type": "application/json" },
      body: JSON.stringify({ accountId: "a", decidedBy: "cli:jag" }),
    });
    const res = await handleApiRequest({ request: req }, d);
    expect(res.status).toBe(200);
    expect(d.decideApproval).toHaveBeenCalledWith({
      id: "appr-1",
      accountId: "a",
      decision: "rejected",
      decidedBy: "cli:jag",
    });
  });
});
