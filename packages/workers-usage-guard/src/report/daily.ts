import type { AccountConfig, NotificationResult, UsageReport } from "usage-guard-shared";
import type { WorkerUsage } from "../graphql/queries.js";
import { estimateWorkersCost } from "../cost.js";

export type DailyReportDeps = {
  now: () => Date;
  id: () => string;
  fetchUsage: (args: {
    accountId: string;
    periodStart: string;
    periodEnd: string;
    scriptNames: string[];
  }) => Promise<{ raw: unknown; rows: WorkerUsage[] }>;
  insertReport: (args: { report: UsageReport }) => Promise<void>;
  dispatch: (args: { report: UsageReport }) => Promise<NotificationResult[]>;
};

function billingPeriod(now: Date, cycleDay: number): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cycleDay));
  if (start.getTime() > now.getTime()) start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCSeconds(end.getUTCSeconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function runDailyReport(
  args: { accounts: AccountConfig[] },
  deps: DailyReportDeps
): Promise<void> {
  const now = deps.now();
  for (const account of args.accounts) {
    const period = billingPeriod(now, account.billingCycleDay);
    const { rows } = await deps.fetchUsage({
      accountId: account.accountId,
      periodStart: period.start,
      periodEnd: period.end,
      scriptNames: account.workers.map((w) => w.scriptName),
    });

    const perWorker = rows
      .map((r) => {
        const cost = estimateWorkersCost({ requests: r.requests, cpuMs: r.cpuMs }).total;
        return { scriptName: r.scriptName, requests: r.requests, cpuMs: r.cpuMs, estimatedCostUsd: cost };
      })
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
    const totals = perWorker.reduce(
      (acc, w) => ({
        requests: acc.requests + w.requests,
        cpuMs: acc.cpuMs + w.cpuMs,
        estimatedCostUsd: acc.estimatedCostUsd + w.estimatedCostUsd,
      }),
      { requests: 0, cpuMs: 0, estimatedCostUsd: 0 }
    );

    const report: UsageReport = {
      id: deps.id(),
      accountId: account.accountId,
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      generatedAt: now.toISOString(),
      payload: { perWorker, totals, savingsThisMonthUsd: 0 },
    };
    await deps.insertReport({ report });
    await deps.dispatch({ report });
  }
}
