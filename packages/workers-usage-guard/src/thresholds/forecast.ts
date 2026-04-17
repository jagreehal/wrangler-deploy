import type { ExpandedRule } from "../config.js";
import type { BreachType } from "usage-guard-shared";

export type ForecastBreach = {
  ruleId: string; // "forecast:<originalRuleId>"
  breachType: BreachType;
  limit: number;
  actual: number; // the PROJECTED value at now + lookahead
};

export function projectBreaches(args: {
  usage: { requests: number; cpuMs: number; estimatedCostUsd: number };
  rules: ExpandedRule[];
  now: Date;
  periodStart: Date;
  forecastEnabled: boolean;
  lookaheadSeconds: number;
}): ForecastBreach[] {
  if (!args.forecastEnabled) return [];
  const elapsedSec = (args.now.getTime() - args.periodStart.getTime()) / 1000;
  if (elapsedSec <= 0) return [];

  const multiplier = (elapsedSec + args.lookaheadSeconds) / elapsedSec;
  const projected = {
    requests: args.usage.requests * multiplier,
    cpuMs: args.usage.cpuMs * multiplier,
    estimatedCostUsd: args.usage.estimatedCostUsd * multiplier,
  };

  const breaches: ForecastBreach[] = [];
  for (const r of args.rules) {
    const tag = `forecast:${r.ruleId}`;
    if (
      r.requests !== undefined &&
      args.usage.requests < r.requests &&
      projected.requests >= r.requests
    ) {
      breaches.push({
        ruleId: tag,
        breachType: "requests",
        limit: r.requests,
        actual: Math.round(projected.requests),
      });
    }
    if (
      r.cpuMs !== undefined &&
      args.usage.cpuMs < r.cpuMs &&
      projected.cpuMs >= r.cpuMs
    ) {
      breaches.push({
        ruleId: tag,
        breachType: "cpu_ms",
        limit: r.cpuMs,
        actual: Math.round(projected.cpuMs),
      });
    }
    if (
      r.costUsd !== undefined &&
      args.usage.estimatedCostUsd < r.costUsd &&
      projected.estimatedCostUsd >= r.costUsd
    ) {
      breaches.push({
        ruleId: tag,
        breachType: "cost",
        limit: r.costUsd,
        actual: Math.round(projected.estimatedCostUsd * 100) / 100,
      });
    }
  }
  return breaches;
}
