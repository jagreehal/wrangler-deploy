import { faker } from "@faker-js/faker";
import type {
  AccountConfig,
  ActivityEvent,
  BreachForensic,
  KillSwitchActions,
  NotificationChannelConfig,
  NotificationConfig,
  NotificationEvent,
  UsageReport,
  UsageSnapshot,
  WorkerConfig,
} from "usage-guard-shared";

faker.seed(1);

export const stubs = {
  uuid: (): string => faker.string.uuid(),
  isoDate: (d?: Date): string => (d ?? faker.date.recent()).toISOString(),
  scriptName: (): string => faker.internet.domainWord(),
  accountId: (): string => faker.string.hexadecimal({ length: 32, casing: "lower", prefix: "" }),
  zoneId: (): string => faker.string.hexadecimal({ length: 32, casing: "lower", prefix: "" }),

  workerConfig: (o: Partial<WorkerConfig> = {}): WorkerConfig => ({
    scriptName: stubs.scriptName(),
    zones: [{ zoneId: stubs.zoneId() }],
    thresholds: { requests: 500_000, cpuMs: 5_000_000 },
    cooldownSeconds: 3600,
    graceSeconds: 14_400,
    ...o,
  }),

  accountConfig: (o: Partial<AccountConfig> = {}): AccountConfig => ({
    accountId: stubs.accountId(),
    billingCycleDay: 1,
    workers: [stubs.workerConfig()],
    globalProtected: [],
    ...o,
  }),

  usageSnapshot: (o: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
    id: stubs.uuid(),
    accountId: stubs.accountId(),
    scriptName: stubs.scriptName(),
    capturedAt: stubs.isoDate(),
    requests: faker.number.int({ min: 0, max: 10_000_000 }),
    cpuMs: faker.number.int({ min: 0, max: 30_000_000 }),
    estimatedCostUsd: faker.number.float({ min: 0, max: 100, fractionDigits: 2 }),
    periodStart: stubs.isoDate(new Date("2026-04-01")),
    periodEnd: stubs.isoDate(new Date("2026-04-30")),
    ...o,
  }),

  breachForensic: (o: Partial<BreachForensic> = {}): BreachForensic => ({
    id: stubs.uuid(),
    breachKey: `${stubs.accountId()}:${stubs.scriptName()}:requests`,
    workflowInstanceId: stubs.uuid(),
    triggeredAt: stubs.isoDate(),
    ruleId: "request-flood",
    graphqlResponse: { data: {} },
    actionsTaken: null,
    estimatedSavingsUsd: null,
    ...o,
  }),

  killSwitchActions: (o: Partial<KillSwitchActions> = {}): KillSwitchActions => ({
    removedRoutes: [],
    removedDomains: [],
    ...o,
  }),

  activityEvent: (o: Partial<ActivityEvent> = {}): ActivityEvent => ({
    id: stubs.uuid(),
    createdAt: stubs.isoDate(),
    actor: "cron:5min",
    action: "breach_detected",
    resourceType: "worker",
    resourceId: stubs.scriptName(),
    details: null,
    ...o,
  }),

  usageReport: (o: Partial<UsageReport> = {}): UsageReport => ({
    id: stubs.uuid(),
    accountId: stubs.accountId(),
    billingPeriodStart: "2026-04-01T00:00:00.000Z",
    billingPeriodEnd: "2026-04-30T23:59:59.999Z",
    generatedAt: stubs.isoDate(),
    payload: {
      perWorker: [],
      totals: { requests: 0, cpuMs: 0, estimatedCostUsd: 0 },
      savingsThisMonthUsd: 0,
    },
    ...o,
  }),

  discordChannelConfig: (o: Partial<Extract<NotificationChannelConfig, { type: "discord" }>> = {}): NotificationChannelConfig => ({
    type: "discord",
    name: "prod",
    webhookUrlSecret: "DISCORD_PROD_WEBHOOK",
    ...o,
  } as const),

  slackChannelConfig: (o: Partial<Extract<NotificationChannelConfig, { type: "slack" }>> = {}): NotificationChannelConfig => ({
    type: "slack",
    name: "eng",
    webhookUrlSecret: "SLACK_ENG_WEBHOOK",
    ...o,
  } as const),

  webhookChannelConfig: (o: Partial<Extract<NotificationChannelConfig, { type: "webhook" }>> = {}): NotificationChannelConfig => ({
    type: "webhook",
    name: "ops",
    urlSecret: "OPS_WEBHOOK_URL",
    ...o,
  } as const),

  notificationConfig: (o: Partial<NotificationConfig> = {}): NotificationConfig => ({
    channels: [stubs.discordChannelConfig()],
    dedupWindowSeconds: 86_400,
    ...o,
  }),

  breachEvent: (o: Partial<Extract<NotificationEvent, { kind: "breach" }>> = {}): NotificationEvent => ({
    kind: "breach",
    severity: "critical",
    breach: stubs.breachForensic(),
    actions: stubs.killSwitchActions(),
    ...o,
  }),

  dailyReportEvent: (
    o: Partial<Extract<NotificationEvent, { kind: "daily-report" }>> = {}
  ): NotificationEvent => ({
    kind: "daily-report",
    severity: "info",
    report: stubs.usageReport(),
    ...o,
  }),
};
