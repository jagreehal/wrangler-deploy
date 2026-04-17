import type { AccountConfig, ActivityEvent, UsageSnapshot } from "usage-guard-shared";
import type { OverageStateRow } from "../db/state.js";
import type { WorkerUsage } from "../graphql/queries.js";
import { expandPresetsForWorker } from "../config.js";
import { detectBreaches } from "../thresholds/evaluate.js";
import { projectBreaches } from "../thresholds/forecast.js";
import { shouldSuppress } from "../cooldown.js";
import { estimateWorkersCost } from "../cost.js";

export type WorkflowCreate = (args: {
  id: string;
  params: {
    accountId: string;
    scriptName: string;
    breachType: "requests" | "cpu_ms" | "cost";
    ruleId: string;
    actual: number;
    limit: number;
    breachKey: string;
    periodStart: string;
    periodEnd: string;
    zones: { zoneId: string }[];
  };
}) => Promise<{ id: string }>;

export type OverageCheckDeps = {
  now: () => Date;
  id: () => string;
  guardScriptName: string;
  loadRuntimeProtectedSet: () => Promise<Set<string>>;
  isProtected: (args: { scriptName: string; guardScriptName: string; account: AccountConfig; runtimeProtected?: Set<string> }) => boolean;
  fetchUsage: (args: {
    accountId: string;
    periodStart: string;
    periodEnd: string;
    scriptNames: string[];
  }) => Promise<{ raw: unknown; rows: WorkerUsage[] }>;
  getState: (args: { breachKey: string }) => Promise<OverageStateRow | null>;
  upsertOnBreach: (args: {
    accountId: string;
    scriptName: string;
    breachType: "requests" | "cpu_ms" | "cost";
    cooldownSeconds: number;
    now?: Date;
  }) => Promise<string>;
  setWorkflowInstanceId: (args: { breachKey: string; workflowInstanceId: string }) => Promise<void>;
  insertSnapshot: (args: { snapshot: UsageSnapshot }) => Promise<void>;
  appendActivity: (args: { event: ActivityEvent }) => Promise<void>;
  createWorkflow: WorkflowCreate;
};

function computeBillingPeriod(now: Date, billingCycleDay: number): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), billingCycleDay, 0, 0, 0));
  if (start.getTime() > now.getTime()) {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCSeconds(end.getUTCSeconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function runOverageCheck(
  args: {
    accounts: AccountConfig[];
    defaults: { requests: number; cpuMs: number; costUsd: number };
    cooldownSeconds: number;
  },
  deps: OverageCheckDeps
): Promise<void> {
  const now = deps.now();
  const runtimeProtected = await deps.loadRuntimeProtectedSet();
  for (const account of args.accounts) {
    const period = computeBillingPeriod(now, account.billingCycleDay);
    const scriptNames = account.workers.map((w) => w.scriptName);
    if (scriptNames.length === 0) continue;

    const { rows } = await deps.fetchUsage({
      accountId: account.accountId,
      periodStart: period.start,
      periodEnd: period.end,
      scriptNames,
    });

    for (const worker of account.workers) {
      const row = rows.find((r) => r.scriptName === worker.scriptName);
      const usage = {
        requests: row?.requests ?? 0,
        cpuMs: row?.cpuMs ?? 0,
        estimatedCostUsd: estimateWorkersCost({ requests: row?.requests ?? 0, cpuMs: row?.cpuMs ?? 0 }).total,
      };
      await deps.insertSnapshot({
        snapshot: {
          id: deps.id(),
          accountId: account.accountId,
          scriptName: worker.scriptName,
          capturedAt: now.toISOString(),
          requests: usage.requests,
          cpuMs: usage.cpuMs,
          estimatedCostUsd: usage.estimatedCostUsd,
          periodStart: period.start,
          periodEnd: period.end,
        },
      });

      if (deps.isProtected({ scriptName: worker.scriptName, guardScriptName: deps.guardScriptName, account, runtimeProtected })) {
        await deps.appendActivity({
          event: {
            id: deps.id(),
            createdAt: now.toISOString(),
            actor: "cron:5min",
            action: "protected_skipped",
            resourceType: "worker",
            resourceId: worker.scriptName,
            details: null,
          },
        });
        continue;
      }

      const rules = expandPresetsForWorker(worker, {
        defaults: { requests: args.defaults.requests, cpuMs: args.defaults.cpuMs },
        rolling: { avgDailyCostUsd: 0 },
      });
      if (rules.length === 0 && worker.thresholds) {
        rules.push({ ruleId: "custom", ...worker.thresholds });
      }
      const detected = detectBreaches({ usage, rules });
      const forecasted = projectBreaches({
        usage,
        rules,
        now,
        periodStart: new Date(period.start),
        forecastEnabled: worker.forecast === true,
        lookaheadSeconds: worker.forecastLookaheadSeconds ?? 600,
      });
      const breaches = [...detected, ...forecasted];

      for (const b of breaches) {
        const breachKey = `${account.accountId}:${worker.scriptName}:${b.breachType}`;
        const state = await deps.getState({ breachKey });
        const suppress = shouldSuppress({ row: state, now });
        if (suppress.suppressed) {
          await deps.appendActivity({
            event: {
              id: deps.id(),
              createdAt: now.toISOString(),
              actor: "cron:5min",
              action: "breach_suppressed",
              resourceType: "worker",
              resourceId: worker.scriptName,
              details: { reason: suppress.reason, until: suppress.until, breachType: b.breachType },
            },
          });
          continue;
        }

        const cooldownSeconds = worker.cooldownSeconds ?? args.cooldownSeconds;
        await deps.upsertOnBreach({
          accountId: account.accountId,
          scriptName: worker.scriptName,
          breachType: b.breachType,
          cooldownSeconds,
          now,
        });

        const wf = await deps.createWorkflow({
          id: `${breachKey}:${period.end.slice(0, 10)}`,
          params: {
            accountId: account.accountId,
            scriptName: worker.scriptName,
            breachType: b.breachType,
            ruleId: b.ruleId,
            actual: b.actual,
            limit: b.limit,
            breachKey,
            periodStart: period.start,
            periodEnd: period.end,
            zones: worker.zones ?? [],
          },
        });
        await deps.setWorkflowInstanceId({ breachKey, workflowInstanceId: wf.id });

        await deps.appendActivity({
          event: {
            id: deps.id(),
            createdAt: now.toISOString(),
            actor: "cron:5min",
            action: "breach_detected",
            resourceType: "worker",
            resourceId: worker.scriptName,
            details: {
              ruleId: b.ruleId,
              breachType: b.breachType,
              actual: b.actual,
              limit: b.limit,
              workflowInstanceId: wf.id,
            },
          },
        });
      }
    }
  }
}
