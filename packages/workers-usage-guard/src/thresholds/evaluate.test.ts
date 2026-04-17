import { describe, it, expect } from "vitest";
import { detectBreaches } from "./evaluate.js";
import type { ExpandedRule } from "../config.js";

const rules: ExpandedRule[] = [
  { ruleId: "request-flood", requests: 1_000_000 },
  { ruleId: "cpu-spike", cpuMs: 20_000_000 },
  { ruleId: "cost-runaway", costUsd: 5 },
];

describe("detectBreaches", () => {
  it("fires request-flood when requests exceed threshold", () => {
    const out = detectBreaches({ usage: { requests: 2_000_000, cpuMs: 0, estimatedCostUsd: 0 }, rules });
    expect(out.some((b) => b.ruleId === "request-flood")).toBe(true);
  });

  it("does not fire when usage under all thresholds", () => {
    const out = detectBreaches({ usage: { requests: 1, cpuMs: 1, estimatedCostUsd: 0 }, rules });
    expect(out).toHaveLength(0);
  });

  it("can fire multiple rules simultaneously", () => {
    const out = detectBreaches({
      usage: { requests: 2_000_000, cpuMs: 21_000_000, estimatedCostUsd: 6 },
      rules,
    });
    expect(out).toHaveLength(3);
  });

  it("maps ruleId to breachType correctly", () => {
    const out = detectBreaches({ usage: { requests: 2_000_000, cpuMs: 0, estimatedCostUsd: 0 }, rules });
    expect(out[0]?.breachType).toBe("requests");
  });
});
