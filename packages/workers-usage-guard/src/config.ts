import type {
  AccountConfig,
  NotificationConfig,
  NotificationChannelConfig,
  PresetRule,
  WorkerConfig,
} from "usage-guard-shared";

export type PresetExpansionContext = {
  defaults: { requests: number; cpuMs: number };
  rolling: { avgDailyCostUsd: number };
};

export type ExpandedRule = {
  ruleId: PresetRule | "custom";
  requests?: number;
  cpuMs?: number;
  costUsd?: number;
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function loadAccountConfig(raw: string): AccountConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`ACCOUNTS_JSON is not valid JSON: ${(e as Error).message}`);
  }
  assert(Array.isArray(parsed), "ACCOUNTS_JSON must be an array");
  return parsed.map((a, i) => {
    assert(a && typeof a === "object", `ACCOUNTS_JSON[${i}] must be an object`);
    const acc = a as Record<string, unknown>;
    assert(typeof acc.accountId === "string", `ACCOUNTS_JSON[${i}].accountId must be a string`);
    assert(Array.isArray(acc.workers), `ACCOUNTS_JSON[${i}].workers must be an array`);
    assert(typeof acc.billingCycleDay === "number", `ACCOUNTS_JSON[${i}].billingCycleDay must be a number`);
    assert(Array.isArray(acc.globalProtected), `ACCOUNTS_JSON[${i}].globalProtected must be an array`);
    const workers = (acc.workers as unknown[]).map((w, j) => {
      assert(w && typeof w === "object", `workers[${j}] must be an object`);
      const ww = w as Record<string, unknown>;
      assert(typeof ww.scriptName === "string", `workers[${j}].scriptName must be a string`);
      return ww as unknown as WorkerConfig;
    });
    return {
      accountId: acc.accountId,
      billingCycleDay: acc.billingCycleDay,
      workers,
      globalProtected: acc.globalProtected as string[],
    };
  });
}

export function loadNotificationConfig(raw: string): Required<Pick<NotificationConfig, "dedupWindowSeconds">> & NotificationConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`NOTIFICATIONS_JSON is not valid JSON: ${(e as Error).message}`);
  }
  assert(parsed && typeof parsed === "object", "NOTIFICATIONS_JSON must be an object");
  const obj = parsed as Record<string, unknown>;
  assert(Array.isArray(obj.channels), "NOTIFICATIONS_JSON.channels must be an array");
  const channels = obj.channels as NotificationChannelConfig[];
  const names = new Set<string>();
  for (const c of channels) {
    assert(typeof c.name === "string" && c.name.length > 0, "channel.name must be a non-empty string");
    assert(!names.has(c.name), `duplicate channel name: ${c.name}`);
    names.add(c.name);
  }
  const dedupWindowSeconds =
    typeof obj.dedupWindowSeconds === "number" ? obj.dedupWindowSeconds : 86_400;
  return { channels, dedupWindowSeconds };
}

export function expandPresetsForWorker(
  worker: WorkerConfig,
  ctx: PresetExpansionContext
): ExpandedRule[] {
  const rules: ExpandedRule[] = [];
  const t = worker.thresholds ?? {};
  for (const p of worker.presets ?? []) {
    if (p === "cost-runaway") {
      rules.push({
        ruleId: "cost-runaway",
        costUsd: t.costUsd ?? ctx.rolling.avgDailyCostUsd * 2,
      });
    } else if (p === "request-flood") {
      rules.push({ ruleId: "request-flood", requests: t.requests ?? ctx.defaults.requests });
    } else if (p === "cpu-spike") {
      rules.push({ ruleId: "cpu-spike", cpuMs: t.cpuMs ?? ctx.defaults.cpuMs });
    }
  }
  if (rules.length === 0 && (t.requests || t.cpuMs || t.costUsd)) {
    rules.push({ ruleId: "custom", requests: t.requests, cpuMs: t.cpuMs, costUsd: t.costUsd });
  }
  return rules;
}
