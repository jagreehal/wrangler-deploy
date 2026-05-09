import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { boolFlag, optionalString } from "../parse.js";
import { createApiClient } from "../lib/api.js";
import { json } from "../lib/output.js";

export const summary = "Read the latest daily report";

export const help = `
wug report [--account <id>] [--date <YYYY-MM-DD>] [--json]
`;

type Report = {
  generatedAt: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  payload: {
    totals: { requests: number; cpuMs: number; estimatedCostUsd: number };
    savingsThisMonthUsd: number;
    perWorker: Array<{ scriptName: string; requests: number; cpuMs: number; estimatedCostUsd: number }>;
  };
};

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const date = optionalString(args.flags, "date");
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  const res = await client.get<{ reports: Report[] }>(
    `/api/reports?account=${encodeURIComponent(account)}`,
  );
  const sorted = [...res.reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const report = date ? sorted.find((r) => r.generatedAt.slice(0, 10) === date) ?? null : sorted[0] ?? null;

  if (boolFlag(args.flags, "json")) {
    console.log(json(report));
    return 0;
  }
  if (!report) {
    console.log("(no report)");
    return 0;
  }
  const p = report.payload;
  const lines = [
    `Report generated: ${report.generatedAt}`,
    `Billing period:   ${report.billingPeriodStart.slice(0, 10)} → ${report.billingPeriodEnd.slice(0, 10)}`,
    `Total: ${fmtInt(p.totals.requests)} requests, ${fmtInt(p.totals.cpuMs)} CPU ms, ${fmtUsd(p.totals.estimatedCostUsd)}`,
    `Savings this month: ${fmtUsd(p.savingsThisMonthUsd)}`,
    "",
    "Per worker:",
  ];
  const sortedWorkers = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  for (const w of sortedWorkers) {
    lines.push(`  ${w.scriptName}: ${fmtInt(w.requests)} req, ${fmtInt(w.cpuMs)} ms, ${fmtUsd(w.estimatedCostUsd)}`);
  }
  console.log(lines.join("\n"));
  return 0;
}
