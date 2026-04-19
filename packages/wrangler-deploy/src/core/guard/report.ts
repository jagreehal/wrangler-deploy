// packages/wrangler-deploy/src/core/guard/report.ts
import type { UsageReport } from "usage-guard-shared";
import type { GuardClient, GuardClientDeps } from "./client.js";

export type ReportRunnerDeps = {
  client: Pick<GuardClient, "get">;
};

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function runReport(
  args: { accountId: string; date?: string },
  deps: ReportRunnerDeps,
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<UsageReport | null> {
  const path = `/api/reports?account=${encodeURIComponent(args.accountId)}`;
  const res = await deps.client.get<{ reports: UsageReport[] }>(path, clientDeps);
  const reports = [...res.reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  if (!args.date) return reports[0] ?? null;
  return reports.find((r) => r.generatedAt.slice(0, 10) === args.date) ?? null;
}

export function renderReportText(report: UsageReport | null): string {
  if (!report) return "(no report)";
  const p = report.payload;
  const periodStart = report.billingPeriodStart.slice(0, 10);
  const periodEnd = report.billingPeriodEnd.slice(0, 10);
  const lines = [
    `Report generated: ${report.generatedAt}`,
    `Billing period:   ${periodStart} → ${periodEnd}`,
    `Total: ${fmtInt(p.totals.requests)} requests, ${fmtInt(p.totals.cpuMs)} CPU ms, ${fmtUsd(p.totals.estimatedCostUsd)}`,
    `Savings this month: ${fmtUsd(p.savingsThisMonthUsd)}`,
    "",
    "Per worker:",
  ];
  const sorted = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  for (const w of sorted) {
    lines.push(
      `  ${w.scriptName}: ${fmtInt(w.requests)} req, ${fmtInt(w.cpuMs)} ms, ${fmtUsd(w.estimatedCostUsd)}`
    );
  }
  return lines.join("\n");
}

export function renderReportJson(report: UsageReport | null): string {
  return JSON.stringify(report, null, 2);
}
