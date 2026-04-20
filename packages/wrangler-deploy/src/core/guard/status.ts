import type { AccountConfig, WorkerUsage } from "../../usage-guard-shared/index.js";

const INCLUDED_REQUESTS = 10_000_000;
const INCLUDED_CPU_MS = 30_000_000;
const COST_PER_M_REQUESTS = 0.30;
const COST_PER_M_CPU_MS = 0.02;

function estimateTotalUsd(args: { requests: number; cpuMs: number }): number {
  const extraReq = Math.max(0, args.requests - INCLUDED_REQUESTS);
  const extraCpu = Math.max(0, args.cpuMs - INCLUDED_CPU_MS);
  return (extraReq / 1_000_000) * COST_PER_M_REQUESTS + (extraCpu / 1_000_000) * COST_PER_M_CPU_MS;
}

function computeBillingPeriod(now: Date, billingCycleDay: number): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), billingCycleDay, 0, 0, 0));
  if (start.getTime() > now.getTime()) start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCSeconds(end.getUTCSeconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type StatusDeps = {
  now: () => Date;
  fetchUsage: (args: {
    accountId: string;
    periodStart: string;
    periodEnd: string;
    scriptNames: string[];
  }) => Promise<{ raw: unknown; rows: WorkerUsage[] }>;
  /** Optional: if provided, overlay recent breaches per account from a deployed guard. */
  breachClient?: {
    get<T>(
      path: string,
      clientDeps?: { now: () => Date; fetch: typeof fetch }
    ): Promise<T>;
  };
};

export type StatusRow = {
  accountId: string;
  scriptName: string;
  requests: number;
  cpuMs: number;
  estimatedCostUsd: number;
  periodStart: string;
  periodEnd: string;
  recentBreaches?: import("../../usage-guard-shared/index.js").BreachForensic[];
};

export async function runStatus(
  args: { accounts: AccountConfig[] },
  deps: StatusDeps
): Promise<StatusRow[]> {
  const now = deps.now();
  const out: StatusRow[] = [];
  for (const account of args.accounts) {
    if (account.workers.length === 0) continue;
    const period = computeBillingPeriod(now, account.billingCycleDay);
    const scriptNames = account.workers.map((w) => w.scriptName);
    const { rows } = await deps.fetchUsage({
      accountId: account.accountId,
      periodStart: period.start,
      periodEnd: period.end,
      scriptNames,
    });
    let recentBreaches: import("../../usage-guard-shared/index.js").BreachForensic[] | undefined;
    if (deps.breachClient) {
      try {
        const res = await deps.breachClient.get<{
          breaches: import("../../usage-guard-shared/index.js").BreachForensic[];
        }>(`/api/breaches?account=${encodeURIComponent(account.accountId)}&limit=5`);
        recentBreaches = res.breaches;
      } catch {
        // overlay is best-effort; fall through with undefined
      }
    }
    for (const worker of account.workers) {
      const row = rows.find((r) => r.scriptName === worker.scriptName);
      const requests = row?.requests ?? 0;
      const cpuMs = row?.cpuMs ?? 0;
      out.push({
        accountId: account.accountId,
        scriptName: worker.scriptName,
        requests,
        cpuMs,
        estimatedCostUsd: estimateTotalUsd({ requests, cpuMs }),
        periodStart: period.start,
        periodEnd: period.end,
        ...(recentBreaches !== undefined ? { recentBreaches } : {}),
      });
    }
  }
  return out;
}
