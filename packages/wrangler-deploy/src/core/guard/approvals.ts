import type { GuardClient, GuardClientDeps } from "./client.js";

export type ApprovalRow = {
  id: string;
  accountId: string;
  scriptName: string;
  breachKey: string;
  createdAt: string;
  expiresAt: string;
  ruleId: string;
  breachType: string;
  actualValue: number;
  limitValue: number;
};

export async function runListApprovals(
  args: { accountId: string },
  deps: { client: Pick<GuardClient, "get"> },
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<ApprovalRow[]> {
  const res = await deps.client.get<{ items: ApprovalRow[] }>(
    `/api/approvals?account=${encodeURIComponent(args.accountId)}`,
    clientDeps
  );
  return res.items;
}

export async function runApprove(
  args: { id: string; accountId: string; decidedBy: string },
  deps: { client: Pick<GuardClient, "post"> },
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<{ ok: true }> {
  return deps.client.post(
    `/api/approvals/${args.id}/approve`,
    { accountId: args.accountId, decidedBy: args.decidedBy },
    clientDeps
  );
}

export async function runReject(
  args: { id: string; accountId: string; decidedBy: string },
  deps: { client: Pick<GuardClient, "post"> },
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<{ ok: true }> {
  return deps.client.post(
    `/api/approvals/${args.id}/reject`,
    { accountId: args.accountId, decidedBy: args.decidedBy },
    clientDeps
  );
}
