import type { BreachType } from "usage-guard-shared";

export type OverageStateRow = {
  breachKey: string;
  accountId: string;
  scriptName: string;
  breachType: BreachType;
  firstSeenAt: string;
  lastSeenAt: string;
  cooldownUntil: string;
  graceUntil: string | null;
  workflowInstanceId: string | null;
};

type RowDb = {
  breach_key: string;
  account_id: string;
  script_name: string;
  breach_type: BreachType;
  first_seen_at: string;
  last_seen_at: string;
  cooldown_until: string;
  grace_until: string | null;
  workflow_instance_id: string | null;
};

function fromRow(r: RowDb): OverageStateRow {
  return {
    breachKey: r.breach_key,
    accountId: r.account_id,
    scriptName: r.script_name,
    breachType: r.breach_type,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    cooldownUntil: r.cooldown_until,
    graceUntil: r.grace_until,
    workflowInstanceId: r.workflow_instance_id,
  };
}

export async function getOverageState(
  args: { breachKey: string },
  deps: { db: D1Database }
): Promise<OverageStateRow | null> {
  const row = await deps.db
    .prepare("SELECT * FROM overage_state WHERE breach_key = ?1")
    .bind(args.breachKey)
    .first<RowDb>();
  return row ? fromRow(row) : null;
}

export async function upsertOverageStateOnBreach(
  args: {
    accountId: string;
    scriptName: string;
    breachType: BreachType;
    cooldownSeconds: number;
    now?: Date;
  },
  deps: { db: D1Database }
): Promise<string> {
  const now = args.now ?? new Date();
  const breachKey = `${args.accountId}:${args.scriptName}:${args.breachType}`;
  const nowIso = now.toISOString();
  const cooldownUntil = new Date(now.getTime() + args.cooldownSeconds * 1000).toISOString();
  await deps.db
    .prepare(
      `INSERT INTO overage_state (
         breach_key, account_id, script_name, breach_type,
         first_seen_at, last_seen_at, cooldown_until
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
       ON CONFLICT(breach_key) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         cooldown_until = excluded.cooldown_until`
    )
    .bind(breachKey, args.accountId, args.scriptName, args.breachType, nowIso, cooldownUntil)
    .run();
  return breachKey;
}

export async function setGraceUntil(
  args: { breachKey: string; graceUntil: string },
  deps: { db: D1Database }
): Promise<void> {
  await deps.db
    .prepare("UPDATE overage_state SET grace_until = ?1 WHERE breach_key = ?2")
    .bind(args.graceUntil, args.breachKey)
    .run();
}

export async function setWorkflowInstanceId(
  args: { breachKey: string; workflowInstanceId: string },
  deps: { db: D1Database }
): Promise<void> {
  await deps.db
    .prepare("UPDATE overage_state SET workflow_instance_id = ?1 WHERE breach_key = ?2")
    .bind(args.workflowInstanceId, args.breachKey)
    .run();
}
