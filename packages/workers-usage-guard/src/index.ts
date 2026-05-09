// src/index.ts
import type { Env } from "./env.js";
import { loadAccountConfig, loadNotificationConfig } from "./config.js";
import { runOverageCheck } from "./scan/overage-check.js";
import { runDailyReport } from "./report/daily.js";
import { handleApiRequest } from "./http/api.js";
import { fetchWorkerUsage } from "./graphql/queries.js";
import { isProtected } from "./cloudflare/protected.js";
import { loadRuntimeProtectedSet, addRuntimeProtection, removeRuntimeProtection, listRuntimeProtected } from "./db/runtime-protected.js";
import { listPendingApprovals, decideApproval, expireStaleApprovals } from "./db/approvals.js";
import { getOverageState, upsertOverageStateOnBreach, setWorkflowInstanceId } from "./db/state.js";
import { insertUsageSnapshot } from "./db/snapshots.js";
import { appendActivity } from "./db/activity.js";
import { listRecentReports } from "./db/reports.js";
import { listRecentBreaches } from "./db/forensics.js";
import { listRecentSnapshots } from "./db/snapshots.js";
import { insertUsageReport } from "./db/reports.js";
import { dispatch } from "./notify/dispatcher.js";
import { discordAdapter } from "./notify/adapters/discord.js";
import { slackAdapter } from "./notify/adapters/slack.js";
import { webhookAdapter } from "./notify/adapters/webhook.js";
import { ssrfValidator } from "./notify/ssrf.js";
import type { NotificationChannel } from "./notify/types.js";
import type { NotificationChannelConfig } from "workers-usage-guard-shared";

export { OverageWorkflow } from "./workflows/kill-switch.js";

export function channelFor(cfg: NotificationChannelConfig): NotificationChannel {
  if (cfg.type === "discord") return discordAdapter(cfg);
  if (cfg.type === "slack") return slackAdapter(cfg);
  return webhookAdapter(cfg);
}

function makeDispatch(env: Env, channels: NotificationChannel[], dedupWindowSeconds: number) {
  return async (event: Parameters<typeof dispatch>[0]["event"]) =>
    dispatch(
      { event, channels },
      {
        fetch,
        clock: () => new Date(),
        ssrf: ssrfValidator,
        secrets: (name) => (typeof env[name] === "string" ? (env[name] as string) : undefined),
        log: async (entry) => {
          await appendActivity({ event: entry }, { db: env.DB });
        },
        db: env.DB,
        dedupWindowSeconds,
      }
    );
}

function parsePositiveNumber(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number (got "${raw}")`);
  }
  return value;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const accounts = loadAccountConfig(env.ACCOUNTS_JSON);
    const notifyConfig = loadNotificationConfig(env.NOTIFICATIONS_JSON);
    const channels = notifyConfig.channels.map(channelFor);
    const token = env.CLOUDFLARE_API_TOKEN;

    if (controller.cron === "*/5 * * * *") {
      const requestThreshold = parsePositiveNumber(env.REQUEST_THRESHOLD, "REQUEST_THRESHOLD");
      const cpuThresholdMs = parsePositiveNumber(env.CPU_TIME_THRESHOLD_MS, "CPU_TIME_THRESHOLD_MS");
      const cooldownSeconds = parsePositiveNumber(env.OVERAGE_COOLDOWN_SECONDS, "OVERAGE_COOLDOWN_SECONDS");
      ctx.waitUntil(expireStaleApprovals({}, { db: env.DB }).catch(() => undefined));
      ctx.waitUntil(
        runOverageCheck(
          {
            accounts,
            defaults: {
              requests: requestThreshold,
              cpuMs: cpuThresholdMs,
              costUsd: Number.POSITIVE_INFINITY,
            },
            cooldownSeconds,
          },
          {
            now: () => new Date(),
            id: () => crypto.randomUUID(),
            guardScriptName: env.GUARD_SCRIPT_NAME,
            loadRuntimeProtectedSet: () => loadRuntimeProtectedSet({ db: env.DB }),
            isProtected,
            fetchUsage: (a) => fetchWorkerUsage(a, { fetch, token }),
            getState: (a) => getOverageState(a, { db: env.DB }),
            upsertOnBreach: (a) => upsertOverageStateOnBreach(a, { db: env.DB }),
            setWorkflowInstanceId: (a) => setWorkflowInstanceId(a, { db: env.DB }),
            insertSnapshot: (a) => insertUsageSnapshot(a, { db: env.DB }),
            appendActivity: (a) => appendActivity(a, { db: env.DB }),
            createWorkflow: async (a) => {
              const instance = await env.OVERAGE_WORKFLOW.create({ id: a.id, params: a.params });
              return { id: instance.id };
            },
          }
        )
      );
      return;
    }
    if (controller.cron === "0 8 * * *") {
      const dispatcher = makeDispatch(env, channels, notifyConfig.dedupWindowSeconds);
      ctx.waitUntil(
        runDailyReport(
          { accounts },
          {
            now: () => new Date(),
            id: () => crypto.randomUUID(),
            fetchUsage: (a) => fetchWorkerUsage(a, { fetch, token }),
            insertReport: (a) => insertUsageReport(a, { db: env.DB }),
            dispatch: (a) => dispatcher({ kind: "daily-report", severity: "info", report: a.report }),
          }
        )
      );
      return;
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const healthQuery = async () => {
      const accounts = loadAccountConfig(env.ACCOUNTS_JSON);
      let lastCheck: string | null = null;
      let lastReport: string | null = null;
      for (const account of accounts) {
        const reports = await listRecentReports({ accountId: account.accountId, limit: 1 }, { db: env.DB }).catch(() => []);
        const breaches = await listRecentBreaches({ accountId: account.accountId, limit: 1 }, { db: env.DB }).catch(() => []);
        lastCheck = maxIso(lastCheck, breaches[0]?.triggeredAt ?? null);
        lastReport = maxIso(lastReport, reports[0]?.generatedAt ?? null);
      }
      return {
        lastCheck,
        lastReport,
      };
    };

    return handleApiRequest(
      { request },
      {
        now: () => new Date(),
        signingKey: env.GUARD_API_SIGNING_KEY,
        listReports: (a) => listRecentReports(a as { accountId: string; limit: number }, { db: env.DB }),
        listBreaches: (a) => listRecentBreaches(a, { db: env.DB }),
        listSnapshots: (a) => listRecentSnapshots({ accountId: a.accountId, scriptName: a.scriptName, limit: a.limit }, { db: env.DB }),
        healthInfo: healthQuery,
        addRuntimeProtection: (a) => addRuntimeProtection(a, { db: env.DB }),
        removeRuntimeProtection: (a) => removeRuntimeProtection(a, { db: env.DB }),
        listRuntimeProtectedOn: (a) => listRuntimeProtected({ accountId: a.accountId }, { db: env.DB }),
        listPendingApprovals: (a) => listPendingApprovals(a, { db: env.DB }),
        decideApproval: (a) => decideApproval(a, { db: env.DB }),
      }
    );
  },
} satisfies ExportedHandler<Env>;
