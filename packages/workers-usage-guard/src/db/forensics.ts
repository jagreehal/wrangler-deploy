import type { BreachForensic, KillSwitchActions } from "usage-guard-shared";

export async function insertBreachForensic(
  args: { forensic: Omit<BreachForensic, "actionsTaken" | "estimatedSavingsUsd"> },
  deps: { db: D1Database }
): Promise<void> {
  const f = args.forensic;
  await deps.db
    .prepare(
      `INSERT INTO breach_forensics
        (id, breach_key, workflow_instance_id, triggered_at, rule_id, graphql_response_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
    .bind(f.id, f.breachKey, f.workflowInstanceId, f.triggeredAt, f.ruleId, JSON.stringify(f.graphqlResponse))
    .run();
}

export async function completeBreachForensic(
  args: { id: string; actions: KillSwitchActions; estimatedSavingsUsd: number },
  deps: { db: D1Database }
): Promise<void> {
  await deps.db
    .prepare(
      "UPDATE breach_forensics SET actions_taken_json = ?1, estimated_savings_usd = ?2 WHERE id = ?3"
    )
    .bind(JSON.stringify(args.actions), args.estimatedSavingsUsd, args.id)
    .run();
}

export async function listRecentBreaches(
  args: { accountId: string; limit: number },
  deps: { db: D1Database }
): Promise<BreachForensic[]> {
  const { results } = await deps.db
    .prepare(
      `SELECT bf.* FROM breach_forensics bf
         JOIN overage_state os ON os.breach_key = bf.breach_key
         WHERE os.account_id = ?1
         ORDER BY bf.triggered_at DESC
         LIMIT ?2`
    )
    .bind(args.accountId, args.limit)
    .all<{
      id: string;
      breach_key: string;
      workflow_instance_id: string;
      triggered_at: string;
      rule_id: string;
      graphql_response_json: string;
      actions_taken_json: string | null;
      estimated_savings_usd: number | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    breachKey: r.breach_key,
    workflowInstanceId: r.workflow_instance_id,
    triggeredAt: r.triggered_at,
    ruleId: r.rule_id,
    graphqlResponse: JSON.parse(r.graphql_response_json),
    actionsTaken: r.actions_taken_json ? JSON.parse(r.actions_taken_json) : null,
    estimatedSavingsUsd: r.estimated_savings_usd,
  }));
}
