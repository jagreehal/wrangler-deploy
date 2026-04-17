import type { BreachType } from "usage-guard-shared";

export type ApprovalRow = {
  id: string;
  accountId: string;
  scriptName: string;
  breachKey: string;
  workflowInstanceId: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
  decidedAt: string | null;
  decidedBy: string | null;
  ruleId: string;
  breachType: BreachType;
  actualValue: number;
  limitValue: number;
};

type ApprovalDbRow = {
  id: string;
  account_id: string;
  script_name: string;
  breach_key: string;
  workflow_instance_id: string;
  created_at: string;
  expires_at: string;
  status: string;
  decided_at: string | null;
  decided_by: string | null;
  rule_id: string;
  breach_type: BreachType;
  actual_value: number;
  limit_value: number;
};

function fromDb(r: ApprovalDbRow): ApprovalRow {
  return {
    id: r.id,
    accountId: r.account_id,
    scriptName: r.script_name,
    breachKey: r.breach_key,
    workflowInstanceId: r.workflow_instance_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.status as ApprovalRow["status"],
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    ruleId: r.rule_id,
    breachType: r.breach_type,
    actualValue: r.actual_value,
    limitValue: r.limit_value,
  };
}

export async function createApproval(
  args: {
    accountId: string;
    scriptName: string;
    breachKey: string;
    workflowInstanceId: string;
    ruleId: string;
    breachType: BreachType;
    actualValue: number;
    limitValue: number;
    expiresInSeconds: number;
    id?: string;
    now?: Date;
  },
  deps: { db: D1Database }
): Promise<string> {
  const id = args.id ?? crypto.randomUUID();
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + args.expiresInSeconds * 1000).toISOString();
  await deps.db.prepare(
    `INSERT INTO pending_approvals (
      id, account_id, script_name, breach_key, workflow_instance_id,
      created_at, expires_at, status, rule_id, breach_type, actual_value, limit_value
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11)`
  ).bind(
    id, args.accountId, args.scriptName, args.breachKey, args.workflowInstanceId,
    now.toISOString(), expiresAt, args.ruleId, args.breachType, args.actualValue, args.limitValue
  ).run();
  return id;
}

export async function getApproval(
  args: { id: string },
  deps: { db: D1Database }
): Promise<ApprovalRow | null> {
  const row = await deps.db.prepare("SELECT * FROM pending_approvals WHERE id = ?1")
    .bind(args.id).first<ApprovalDbRow>();
  return row ? fromDb(row) : null;
}

export async function listPendingApprovals(
  args: { accountId: string; now?: Date },
  deps: { db: D1Database }
): Promise<ApprovalRow[]> {
  const now = (args.now ?? new Date()).toISOString();
  const { results } = await deps.db.prepare(
    "SELECT * FROM pending_approvals WHERE account_id = ?1 AND status = 'pending' AND expires_at > ?2 ORDER BY created_at DESC"
  ).bind(args.accountId, now).all<ApprovalDbRow>();
  return results.map(fromDb);
}

export async function decideApproval(
  args: { id: string; accountId: string; decision: "approved" | "rejected"; decidedBy: string; now?: Date },
  deps: { db: D1Database }
): Promise<{ updated: boolean }> {
  const now = args.now ?? new Date();
  const result = await deps.db.prepare(
    "UPDATE pending_approvals SET status = ?1, decided_at = ?2, decided_by = ?3 WHERE id = ?4 AND account_id = ?5 AND status = 'pending'"
  ).bind(args.decision, now.toISOString(), args.decidedBy, args.id, args.accountId).run();
  return { updated: ((result.meta?.changes as number) ?? 0) > 0 };
}

export async function expireApproval(
  args: { id: string },
  deps: { db: D1Database }
): Promise<void> {
  await deps.db.prepare(
    "UPDATE pending_approvals SET status = 'expired' WHERE id = ?1 AND status = 'pending'"
  ).bind(args.id).run();
}

export async function expireStaleApprovals(
  args: { now?: Date },
  deps: { db: D1Database }
): Promise<number> {
  const now = args.now ?? new Date();
  const result = await deps.db.prepare(
    "UPDATE pending_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < ?1"
  ).bind(now.toISOString()).run();
  return (result.meta?.changes as number) ?? 0;
}
