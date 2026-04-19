import { describe, it, expect } from "vitest";
import { projectBreaches } from "./forecast.js";
import type { ExpandedRule } from "../config.js";

const rules: ExpandedRule[] = [
  { ruleId: "request-flood", requests: 1_000_000 },
  { ruleId: "cpu-spike", cpuMs: 20_000_000 },
  { ruleId: "cost-runaway", costUsd: 5 },
];

describe("projectBreaches", () => {
  it("returns empty when forecast disabled", () => {
    const out = projectBreaches({
      usage: { requests: 100_000, cpuMs: 1_000_000, estimatedCostUsd: 0 },
      rules,
      now: new Date("2026-04-17T12:30:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: false,
      lookaheadSeconds: 600,
    });
    expect(out).toEqual([]);
  });

  it("returns empty when elapsed is zero", () => {
    const out = projectBreaches({
      usage: { requests: 100_000, cpuMs: 0, estimatedCostUsd: 0 },
      rules,
      now: new Date("2026-04-17T00:00:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: true,
      lookaheadSeconds: 600,
    });
    expect(out).toEqual([]);
  });

  it("fires request-flood on projection when current is below threshold", () => {
    // elapsed: 60s, lookahead: 60s → projection multiplier 2x
    // current 600k requests → projected 1.2M → above 1M threshold
    const out = projectBreaches({
      usage: { requests: 600_000, cpuMs: 0, estimatedCostUsd: 0 },
      rules,
      now: new Date("2026-04-17T00:01:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: true,
      lookaheadSeconds: 60,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.breachType).toBe("requests");
    expect(out[0]?.ruleId).toBe("forecast:request-flood");
  });

  it("does not fire when current already exceeds threshold (avoid duplicate with detectBreaches)", () => {
    const out = projectBreaches({
      usage: { requests: 2_000_000, cpuMs: 0, estimatedCostUsd: 0 },
      rules,
      now: new Date("2026-04-17T00:01:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: true,
      lookaheadSeconds: 60,
    });
    expect(out).toEqual([]);
  });

  it("does not fire when projection is also below threshold", () => {
    const out = projectBreaches({
      usage: { requests: 1_000, cpuMs: 0, estimatedCostUsd: 0 },
      rules,
      now: new Date("2026-04-17T00:01:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: true,
      lookaheadSeconds: 60,
    });
    expect(out).toEqual([]);
  });

  it("can fire multiple forecast breaches simultaneously", () => {
    // all three metrics projected above threshold, none currently above
    const out = projectBreaches({
      usage: { requests: 600_000, cpuMs: 12_000_000, estimatedCostUsd: 3 },
      rules,
      now: new Date("2026-04-17T00:01:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: true,
      lookaheadSeconds: 60,
    });
    expect(out).toHaveLength(3);
    expect(out.map((b) => b.breachType).sort()).toEqual(["cost", "cpu_ms", "requests"]);
  });

  it("actual value reports the projected number, not the current", () => {
    const out = projectBreaches({
      usage: { requests: 600_000, cpuMs: 0, estimatedCostUsd: 0 },
      rules,
      now: new Date("2026-04-17T00:01:00Z"),
      periodStart: new Date("2026-04-17T00:00:00Z"),
      forecastEnabled: true,
      lookaheadSeconds: 60,
    });
    // 600k * (60 + 60) / 60 = 1,200,000
    expect(out[0]?.actual).toBe(1_200_000);
  });
});
