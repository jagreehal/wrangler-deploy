import type { UsageReport } from "usage-guard-shared";

export async function insertUsageReport(
  args: { report: UsageReport },
  deps: { db: D1Database }
): Promise<void> {
  const r = args.report;
  await deps.db
    .prepare(
      `INSERT INTO usage_reports
        (id, account_id, billing_period_start, billing_period_end, generated_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
    .bind(r.id, r.accountId, r.billingPeriodStart, r.billingPeriodEnd, r.generatedAt, JSON.stringify(r.payload))
    .run();
}

export async function listRecentReports(
  args: { accountId: string; limit: number },
  deps: { db: D1Database }
): Promise<UsageReport[]> {
  const { results } = await deps.db
    .prepare(
      `SELECT id, account_id, billing_period_start, billing_period_end, generated_at, payload_json
         FROM usage_reports
        WHERE account_id = ?1
        ORDER BY generated_at DESC
        LIMIT ?2`
    )
    .bind(args.accountId, args.limit)
    .all<{
      id: string;
      account_id: string;
      billing_period_start: string;
      billing_period_end: string;
      generated_at: string;
      payload_json: string;
    }>();
  return results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    billingPeriodStart: r.billing_period_start,
    billingPeriodEnd: r.billing_period_end,
    generatedAt: r.generated_at,
    payload: JSON.parse(r.payload_json),
  }));
}
