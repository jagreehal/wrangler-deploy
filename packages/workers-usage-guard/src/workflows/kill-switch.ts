// src/workflows/kill-switch.ts
/* eslint-disable no-restricted-syntax */
// ^ disabled because the platform class below uses await import() deliberately
//   to avoid pulling config/deps modules into step-function unit tests.
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type {
  AccountConfig,
  ActivityEvent,
  BreachForensic,
  BreachType,
  KillSwitchActions,
  NotificationResult,
} from "usage-guard-shared";
import type { Env } from "../env.js";
import type { RemovedRoute } from "../cloudflare/routes.js";

export type KillParams = {
  accountId: string;
  scriptName: string;
  breachType: BreachType;
  ruleId: string;
  actual: number;
  limit: number;
  breachKey: string;
  periodStart: string;
  periodEnd: string;
  zones: { zoneId: string }[];
};

export type StepDeps = {
  now: () => Date;
  id: () => string;
  loadRuntimeProtectedSet: () => Promise<Set<string>>;
  isProtected: (args: {
    scriptName: string;
    guardScriptName: string;
    account: AccountConfig;
    runtimeProtected?: Set<string>;
  }) => boolean;
  detachRoutes: (args: { scriptName: string; zones: { zoneId: string }[] }) => Promise<RemovedRoute[]>;
  detachDomains: (args: { accountId: string; scriptName: string }) => Promise<string[]>;
  disableWorkersDev: (args: { accountId: string; scriptName: string }) => Promise<void>;
  insertForensic: (args: { forensic: Omit<BreachForensic, "actionsTaken" | "estimatedSavingsUsd"> }) => Promise<void>;
  completeForensic: (args: { id: string; actions: KillSwitchActions; estimatedSavingsUsd: number }) => Promise<void>;
  appendActivity: (args: { event: ActivityEvent }) => Promise<void>;
  setGraceUntil: (args: { breachKey: string; graceUntil: string }) => Promise<void>;
  dispatch: (args: {
    breachForensic: BreachForensic;
    actions: KillSwitchActions;
    severity: "warning" | "critical";
  }) => Promise<NotificationResult[]>;
};

export async function stepProtectedCheck(
  args: {
    accountId: string;
    scriptName: string;
    guardScriptName: string;
    account: AccountConfig;
    breachKey: string;
    workflowInstanceId: string;
    runtimeProtected: Set<string>;
  },
  deps: StepDeps
): Promise<{ proceed: boolean }> {
  const protectedFlag = deps.isProtected({
    scriptName: args.scriptName,
    guardScriptName: args.guardScriptName,
    account: args.account,
    runtimeProtected: args.runtimeProtected,
  });
  if (protectedFlag) {
    await deps.appendActivity({
      event: {
        id: deps.id(),
        createdAt: deps.now().toISOString(),
        actor: "workflow:kill-switch",
        action: "protected_shortcircuit",
        resourceType: "worker",
        resourceId: args.scriptName,
        details: { breachKey: args.breachKey, workflowInstanceId: args.workflowInstanceId },
      },
    });
    return { proceed: false };
  }
  return { proceed: true };
}

export async function stepCaptureForensics(
  args: { params: KillParams; workflowInstanceId: string; graphqlResponse: unknown },
  deps: StepDeps
): Promise<{ forensic: BreachForensic }> {
  const now = deps.now();
  const forensic: BreachForensic = {
    id: deps.id(),
    breachKey: args.params.breachKey,
    workflowInstanceId: args.workflowInstanceId,
    triggeredAt: now.toISOString(),
    ruleId: args.params.ruleId,
    graphqlResponse: args.graphqlResponse,
    actionsTaken: null,
    estimatedSavingsUsd: null,
  };
  await deps.insertForensic({ forensic });
  return { forensic };
}

export async function stepDetachRoutes(
  args: { params: KillParams },
  deps: StepDeps
): Promise<RemovedRoute[]> {
  return deps.detachRoutes({ scriptName: args.params.scriptName, zones: args.params.zones });
}

export async function stepDetachDomains(
  args: { params: KillParams },
  deps: StepDeps
): Promise<string[]> {
  return deps.detachDomains({ accountId: args.params.accountId, scriptName: args.params.scriptName });
}

export async function stepDisableWorkersDev(
  args: { params: KillParams },
  deps: StepDeps
): Promise<void> {
  return deps.disableWorkersDev({ accountId: args.params.accountId, scriptName: args.params.scriptName });
}

export async function stepNotify(
  args: {
    breachForensic: BreachForensic;
    actions: KillSwitchActions;
    severity: "warning" | "critical";
  },
  deps: StepDeps
): Promise<NotificationResult[]> {
  return deps.dispatch(args);
}

export async function stepLogActivity(
  args: {
    workflowInstanceId: string;
    accountId: string;
    scriptName: string;
    removedRoutes: RemovedRoute[];
    removedDomains: string[];
  },
  deps: StepDeps
): Promise<void> {
  for (const r of args.removedRoutes) {
    await deps.appendActivity({
      event: {
        id: deps.id(),
        createdAt: deps.now().toISOString(),
        actor: "workflow:kill-switch",
        action: "routes_detached",
        resourceType: "zone_route",
        resourceId: r.routeId,
        details: {
          accountId: args.accountId,
          scriptName: args.scriptName,
          zoneId: r.zoneId,
          pattern: r.pattern,
          workflowInstanceId: args.workflowInstanceId,
        },
      },
    });
  }
  for (const host of args.removedDomains) {
    await deps.appendActivity({
      event: {
        id: deps.id(),
        createdAt: deps.now().toISOString(),
        actor: "workflow:kill-switch",
        action: "domain_detached",
        resourceType: "worker_domain",
        resourceId: host,
        details: {
          accountId: args.accountId,
          scriptName: args.scriptName,
          workflowInstanceId: args.workflowInstanceId,
        },
      },
    });
  }
}

export async function stepSetGrace(
  args: { breachKey: string; graceSeconds: number },
  deps: StepDeps
): Promise<void> {
  const graceUntil = new Date(deps.now().getTime() + args.graceSeconds * 1000).toISOString();
  await deps.setGraceUntil({ breachKey: args.breachKey, graceUntil });
}

export async function stepAwaitApproval(
  args: {
    accountId: string;
    scriptName: string;
    breachKey: string;
    workflowInstanceId: string;
    ruleId: string;
    breachType: BreachType;
    actualValue: number;
    limitValue: number;
    approvalTimeoutSeconds: number;
    pollIntervalSeconds: number;
    sleep: (label: string, seconds: number) => Promise<void>;
  },
  deps: StepDeps & {
    createApproval: (args: {
      id: string;
      accountId: string;
      scriptName: string;
      breachKey: string;
      workflowInstanceId: string;
      ruleId: string;
      breachType: BreachType;
      actualValue: number;
      limitValue: number;
      expiresInSeconds: number;
      now: Date;
    }) => Promise<string>;
    getApproval: (args: { id: string }) => Promise<{ status: string } | null>;
    expireApproval: (args: { id: string }) => Promise<void>;
    dispatchApprovalNotification: (approvalId: string) => Promise<void>;
  }
): Promise<{ decision: "approved" | "rejected" | "expired" }> {
  const approvalId = deps.id();
  const now = deps.now();

  await deps.createApproval({
    id: approvalId,
    accountId: args.accountId,
    scriptName: args.scriptName,
    breachKey: args.breachKey,
    workflowInstanceId: args.workflowInstanceId,
    ruleId: args.ruleId,
    breachType: args.breachType,
    actualValue: args.actualValue,
    limitValue: args.limitValue,
    expiresInSeconds: args.approvalTimeoutSeconds,
    now,
  });

  await deps.dispatchApprovalNotification(approvalId);

  const deadline = now.getTime() + args.approvalTimeoutSeconds * 1000;
  while (deps.now().getTime() < deadline) {
    const approval = await deps.getApproval({ id: approvalId });
    if (approval && approval.status !== "pending") {
      return { decision: approval.status as "approved" | "rejected" | "expired" };
    }
    await args.sleep("wait-for-approval", args.pollIntervalSeconds);
  }

  // Do a final read before marking expired — approval may have arrived between
  // the last poll and the deadline boundary.
  const finalApproval = await deps.getApproval({ id: approvalId });
  if (finalApproval && finalApproval.status !== "pending") {
    return { decision: finalApproval.status as "approved" | "rejected" | "expired" };
  }

  await deps.expireApproval({ id: approvalId });
  return { decision: "expired" };
}

// The platform class.
export class OverageWorkflow extends WorkflowEntrypoint<Env, KillParams> {
  async run(event: WorkflowEvent<KillParams>, step: WorkflowStep): Promise<void> {
    const { makeKillSwitchDeps } = await import("./kill-switch-deps.js");
    const deps = makeKillSwitchDeps(this.env);
    const params = event.payload;
    const wfId = event.instanceId;

    const { loadAccountConfig } = await import("../config.js");
    const accounts = loadAccountConfig(this.env.ACCOUNTS_JSON);
    const account = accounts.find((a) => a.accountId === params.accountId);
    if (!account) return;

    const runtimeProtected = await step.do("load-runtime-protected", async () =>
      deps.loadRuntimeProtectedSet()
    );

    const { proceed } = await step.do("protected-check", async () =>
      stepProtectedCheck(
        {
          accountId: params.accountId,
          scriptName: params.scriptName,
          guardScriptName: this.env.GUARD_SCRIPT_NAME,
          account,
          breachKey: params.breachKey,
          workflowInstanceId: wfId,
          runtimeProtected,
        },
        deps
      )
    );
    if (!proceed) return;

    const { createApproval, getApproval, expireApproval } = await import("../db/approvals.js");
    const { loadNotificationConfig } = await import("../config.js");
    const { channelFor } = await import("../index.js");
    const notifyConfig = loadNotificationConfig(this.env.NOTIFICATIONS_JSON);
    const channels = notifyConfig.channels.map(channelFor);
    const { dispatch } = await import("../notify/dispatcher.js");
    const { ssrfValidator } = await import("../notify/ssrf.js");
    const { appendActivity } = await import("../db/activity.js");

    const approvalResult = await step.do("await-approval", async () =>
      stepAwaitApproval(
        {
          accountId: params.accountId,
          scriptName: params.scriptName,
          breachKey: params.breachKey,
          workflowInstanceId: wfId,
          ruleId: params.ruleId,
          breachType: params.breachType,
          actualValue: params.actual,
          limitValue: params.limit,
          approvalTimeoutSeconds: 3600,
          pollIntervalSeconds: 30,
          sleep: (label, seconds) => step.sleep(label, seconds),
        },
        {
          ...deps,
          createApproval: (a) => createApproval(a, { db: this.env.DB }),
          getApproval: (a) => getApproval(a, { db: this.env.DB }),
          expireApproval: (a) => expireApproval(a, { db: this.env.DB }),
          dispatchApprovalNotification: async (approvalId) => {
            await dispatch(
              {
                event: {
                  kind: "approval-requested",
                  severity: "warning",
                  approvalId,
                  accountId: params.accountId,
                  scriptName: params.scriptName,
                  ruleId: params.ruleId,
                  breachType: params.breachType,
                  actualValue: params.actual,
                  limitValue: params.limit,
                },
                channels,
              },
              {
                fetch,
                clock: () => new Date(),
                ssrf: ssrfValidator,
                secrets: (name) => (typeof this.env[name] === "string" ? (this.env[name] as string) : undefined),
                log: async (entry) => {
                  await appendActivity({ event: entry }, { db: this.env.DB });
                },
                db: this.env.DB,
                dedupWindowSeconds: notifyConfig.dedupWindowSeconds,
              }
            );
          },
        }
      )
    );

    if (approvalResult.decision === "rejected" || approvalResult.decision === "expired") {
      await deps.appendActivity({
        event: {
          id: deps.id(),
          createdAt: deps.now().toISOString(),
          actor: "workflow:kill-switch",
          action: `approval_${approvalResult.decision}`,
          resourceType: "worker",
          resourceId: params.scriptName,
          details: { breachKey: params.breachKey, workflowInstanceId: wfId },
        },
      });
      return;
    }

    const { forensic } = await step.do(
      "capture-forensics",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => stepCaptureForensics({ params, workflowInstanceId: wfId, graphqlResponse: {} }, deps) as any
    );

    const removedRoutes = await step.do("detach-routes", async () =>
      stepDetachRoutes({ params }, deps)
    );

    const removedDomains = await step.do("detach-custom-domains", async () =>
      stepDetachDomains({ params }, deps)
    );

    await step.do("disable-workers-dev", async () =>
      stepDisableWorkersDev({ params }, deps)
    );

    const actions: KillSwitchActions = { removedRoutes, removedDomains };

    await step.do("notify", async () =>
      stepNotify({ breachForensic: forensic, actions, severity: "critical" }, deps)
    );

    await step.do("log-activity", async () =>
      stepLogActivity(
        {
          workflowInstanceId: wfId,
          accountId: params.accountId,
          scriptName: params.scriptName,
          removedRoutes,
          removedDomains,
        },
        deps
      )
    );

    const worker = account.workers.find((w) => w.scriptName === params.scriptName);
    const graceSeconds = worker?.graceSeconds ?? Number(this.env.OVERAGE_GRACE_SECONDS);
    await step.do("set-grace-period", async () =>
      stepSetGrace({ breachKey: params.breachKey, graceSeconds }, deps)
    );

    await deps.completeForensic({ id: forensic.id, actions, estimatedSavingsUsd: 0 });
  }
}
