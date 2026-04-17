export type PresetRule = "cost-runaway" | "request-flood" | "cpu-spike";

export type WorkerThresholds = {
  requests?: number;
  cpuMs?: number;
  costUsd?: number;
};

export type WorkerConfig = {
  scriptName: string;
  zones?: { zoneId: string }[];
  thresholds?: WorkerThresholds;
  presets?: PresetRule[];
  protected?: boolean;
  cooldownSeconds?: number;
  graceSeconds?: number;
  /**
   * Forecast-mode early trigger. When true, the scan projects current
   * billing-period usage forward by `forecastLookaheadSeconds` and fires
   * a breach if the projection exceeds a rule threshold.
   */
  forecast?: boolean;
  /**
   * How far ahead (in seconds) to project current usage when forecast
   * is enabled. Default: 600 (10 minutes — two 5-minute scan windows).
   */
  forecastLookaheadSeconds?: number;
};

export type AccountConfig = {
  accountId: string;
  billingCycleDay: number;
  workers: WorkerConfig[];
  globalProtected: string[];
};

export type UsageSnapshot = {
  id: string;
  accountId: string;
  scriptName: string;
  capturedAt: string;
  requests: number;
  cpuMs: number;
  estimatedCostUsd: number;
  periodStart: string;
  periodEnd: string;
};

export type UsageReport = {
  id: string;
  accountId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  generatedAt: string;
  payload: {
    perWorker: Array<{
      scriptName: string;
      requests: number;
      cpuMs: number;
      estimatedCostUsd: number;
    }>;
    totals: { requests: number; cpuMs: number; estimatedCostUsd: number };
    savingsThisMonthUsd: number;
  };
};

export type BreachType = "requests" | "cpu_ms" | "cost";

export type BreachForensic = {
  id: string;
  breachKey: string;
  workflowInstanceId: string;
  triggeredAt: string;
  ruleId: string;
  graphqlResponse: unknown;
  actionsTaken:
    | null
    | {
        removedRoutes: Array<{ zoneId: string; routeId: string; pattern: string }>;
        removedDomains: string[];
      };
  estimatedSavingsUsd: number | null;
};

export type ActivityEvent = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown> | null;
};

export type NotificationChannelConfig =
  | { type: "discord"; name: string; webhookUrlSecret: string; minSeverity?: "warning" | "critical" }
  | { type: "slack"; name: string; webhookUrlSecret: string; minSeverity?: "warning" | "critical" }
  | {
      type: "webhook";
      name: string;
      urlSecret: string;
      headers?: Record<string, string>;
      minSeverity?: "warning" | "critical";
    };

export type NotificationConfig = {
  channels: NotificationChannelConfig[];
  dedupWindowSeconds?: number;
};

export type KillSwitchActions = {
  removedRoutes: Array<{ zoneId: string; routeId: string; pattern: string }>;
  removedDomains: string[];
};

export type NotificationEvent =
  | {
      kind: "breach";
      severity: "warning" | "critical";
      breach: BreachForensic;
      actions: KillSwitchActions;
    }
  | {
      kind: "breach-suppressed";
      severity: "info";
      breach: Omit<BreachForensic, "actionsTaken">;
      reason: "cooldown" | "grace" | "protected";
    }
  | { kind: "daily-report"; severity: "info"; report: UsageReport }
  | { kind: "deploy-guard-check"; severity: "info"; result: "ok" | "warn"; details: string }
  | {
      kind: "approval-requested";
      severity: "warning";
      approvalId: string;
      accountId: string;
      scriptName: string;
      ruleId: string;
      breachType: BreachType;
      actualValue: number;
      limitValue: number;
    };

export type NotificationErrorCode = "SSRF" | "NON_2XX" | "TIMEOUT" | "BAD_CONFIG";

export type NotificationResult =
  | { ok: true; channel: string; sentAt: string; dedupKey: string }
  | { ok: false; channel: string; error: { code: NotificationErrorCode; message: string } };
