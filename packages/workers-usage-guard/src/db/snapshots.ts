import type { UsageSnapshot } from "usage-guard-shared";

export async function insertUsageSnapshot(
  args: { snapshot: UsageSnapshot },
  deps: { db: D1Database }
): Promise<void> {
  const s = args.snapshot;
  await deps.db
    .prepare(
      `INSERT INTO usage_snapshots
         (id, account_id, script_name, captured_at, requests, cpu_ms, estimated_cost_usd, period_start, period_end)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
    .bind(
      s.id, s.accountId, s.scriptName, s.capturedAt,
      s.requests, s.cpuMs, s.estimatedCostUsd, s.periodStart, s.periodEnd
    )
    .run();
}

export async function listRecentSnapshots(
  args: { accountId: string; scriptName: string; limit: number },
  deps: { db: D1Database }
): Promise<UsageSnapshot[]> {
  const { results } = await deps.db
    .prepare(
      `SELECT id, account_id, script_name, captured_at, requests, cpu_ms,
              estimated_cost_usd, period_start, period_end
         FROM usage_snapshots
        WHERE account_id = ?1 AND script_name = ?2
        ORDER BY captured_at DESC
        LIMIT ?3`
    )
    .bind(args.accountId, args.scriptName, args.limit)
    .all<{
      id: string;
      account_id: string;
      script_name: string;
      captured_at: string;
      requests: number;
      cpu_ms: number;
      estimated_cost_usd: number;
      period_start: string;
      period_end: string;
    }>();
  return results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    scriptName: r.script_name,
    capturedAt: r.captured_at,
    requests: r.requests,
    cpuMs: r.cpu_ms,
    estimatedCostUsd: r.estimated_cost_usd,
    periodStart: r.period_start,
    periodEnd: r.period_end,
  }));
}
