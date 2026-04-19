import type { ExpandedRule } from "../config.js";
import type { BreachType } from "usage-guard-shared";

export type Breach = {
  ruleId: ExpandedRule["ruleId"];
  breachType: BreachType;
  limit: number;
  actual: number;
};

export function detectBreaches(args: {
  usage: { requests: number; cpuMs: number; estimatedCostUsd: number };
  rules: ExpandedRule[];
}): Breach[] {
  const breaches: Breach[] = [];
  for (const r of args.rules) {
    if (r.requests !== undefined && args.usage.requests >= r.requests) {
      breaches.push({ ruleId: r.ruleId, breachType: "requests", limit: r.requests, actual: args.usage.requests });
    }
    if (r.cpuMs !== undefined && args.usage.cpuMs >= r.cpuMs) {
      breaches.push({ ruleId: r.ruleId, breachType: "cpu_ms", limit: r.cpuMs, actual: args.usage.cpuMs });
    }
    if (r.costUsd !== undefined && args.usage.estimatedCostUsd >= r.costUsd) {
      breaches.push({ ruleId: r.ruleId, breachType: "cost", limit: r.costUsd, actual: args.usage.estimatedCostUsd });
    }
  }
  return breaches;
}
