// src/http/api.ts
import type { BreachForensic, UsageReport, UsageSnapshot } from "usage-guard-shared";
import { verifyRequest } from "./signing.js";
import type { ApprovalRow } from "../db/approvals.js";

export type ApiDeps = {
  now: () => Date;
  signingKey: string;
  listReports: (args: { accountId: string; from?: string; to?: string }) => Promise<UsageReport[]>;
  listBreaches: (args: { accountId: string; limit: number }) => Promise<BreachForensic[]>;
  listSnapshots: (args: { accountId: string; scriptName: string; window: string }) => Promise<UsageSnapshot[]>;
  healthInfo: () => Promise<{ lastCheck: string | null; lastReport: string | null }>;
  addRuntimeProtection: (args: { accountId: string; scriptName: string; addedBy: string; reason?: string }) => Promise<void>;
  removeRuntimeProtection: (args: { accountId: string; scriptName: string }) => Promise<void>;
  listRuntimeProtectedOn: (args: { accountId: string }) => Promise<Array<{
    accountId: string;
    scriptName: string;
    addedAt: string;
    addedBy: string;
    reason: string | null;
  }>>;
  listPendingApprovals: (args: { accountId: string }) => Promise<ApprovalRow[]>;
  decideApproval: (args: { id: string; accountId: string; decision: "approved" | "rejected"; decidedBy: string }) => Promise<{ updated: boolean }>;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function requireSigned(req: Request, deps: ApiDeps, path: string): Promise<Response | null> {
  const ts = req.headers.get("x-guard-timestamp");
  const sig = req.headers.get("x-guard-signature");
  if (!ts || !sig) return json(401, { error: "missing signature" });
  const ok = await verifyRequest({
    method: req.method,
    path,
    timestamp: ts,
    signature: sig,
    key: deps.signingKey,
    now: deps.now(),
    maxSkewSeconds: 300,
  });
  return ok ? null : json(401, { error: "bad signature" });
}

export async function handleApiRequest(
  args: { request: Request },
  deps: ApiDeps
): Promise<Response> {
  const url = new URL(args.request.url);
  const path = url.pathname + url.search;
  const route = url.pathname;

  if (route === "/api/health") {
    const info = await deps.healthInfo();
    return json(200, { ok: true, ...info });
  }

  const denied = await requireSigned(args.request, deps, path);
  if (denied) return denied;

  if (args.request.method === "POST") {
    if (route === "/api/disarm") {
      let body: { accountId?: string; scriptName?: string; addedBy?: string; reason?: string };
      try {
        body = (await args.request.json()) as typeof body;
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body.accountId || !body.scriptName) {
        return json(400, { error: "accountId and scriptName are required" });
      }
      await deps.addRuntimeProtection({
        accountId: body.accountId,
        scriptName: body.scriptName,
        addedBy: body.addedBy ?? "cli:unknown",
        ...(body.reason ? { reason: body.reason } : {}),
      });
      return json(200, { ok: true });
    }

    const approveMatch = route.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
    if (approveMatch) {
      const [, approvalId, action] = approveMatch;
      let body: { accountId?: string; decidedBy?: string };
      try {
        body = (await args.request.json()) as typeof body;
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body.accountId) {
        return json(400, { error: "accountId is required" });
      }
      const { updated } = await deps.decideApproval({
        id: approvalId!,
        accountId: body.accountId,
        decision: action === "approve" ? "approved" : "rejected",
        decidedBy: body.decidedBy ?? "cli:unknown",
      });
      if (!updated) return json(404, { error: "approval not found or already decided" });
      return json(200, { ok: true });
    }

    return json(404, { error: "not found" });
  }
  if (args.request.method === "DELETE") {
    if (route === "/api/disarm") {
      let body: { accountId?: string; scriptName?: string };
      try {
        body = (await args.request.json()) as typeof body;
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body.accountId || !body.scriptName) {
        return json(400, { error: "accountId and scriptName are required" });
      }
      await deps.removeRuntimeProtection({
        accountId: body.accountId,
        scriptName: body.scriptName,
      });
      return json(200, { ok: true });
    }
    return json(404, { error: "not found" });
  }

  const accountId = url.searchParams.get("account");
  if (!accountId) return json(400, { error: "missing account" });

  if (route === "/api/reports") {
    const reports = await deps.listReports({
      accountId,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return json(200, { reports });
  }
  if (route === "/api/breaches") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const breaches = await deps.listBreaches({ accountId, limit });
    return json(200, { breaches });
  }
  if (route === "/api/snapshots") {
    const scriptName = url.searchParams.get("script");
    if (!scriptName) return json(400, { error: "missing script" });
    const window = url.searchParams.get("window") ?? "7d";
    const snapshots = await deps.listSnapshots({ accountId, scriptName, window });
    return json(200, { snapshots });
  }
  if (route === "/api/runtime-protected") {
    const items = await deps.listRuntimeProtectedOn({ accountId });
    return json(200, { items });
  }
  if (route === "/api/approvals") {
    const items = await deps.listPendingApprovals({ accountId });
    return json(200, { items });
  }
  return json(404, { error: "not found" });
}
