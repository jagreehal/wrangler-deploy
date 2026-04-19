import { describe, it, expect } from "vitest";
import { estimateWorkersCost, estimateSavingsUsd } from "./cost.js";

describe("estimateWorkersCost", () => {
  it("charges nothing inside free tier", () => {
    expect(estimateWorkersCost({ requests: 5_000_000, cpuMs: 10_000_000 }).total).toBe(0);
  });

  it("request overage at $0.30/M", () => {
    const r = estimateWorkersCost({ requests: 11_000_000, cpuMs: 0 });
    expect(r.requestsCost).toBeCloseTo(0.30, 6);
    expect(r.total).toBeCloseTo(0.30, 6);
  });

  it("cpu overage at $0.02/M ms", () => {
    const r = estimateWorkersCost({ requests: 0, cpuMs: 31_000_000 });
    expect(r.cpuCost).toBeCloseTo(0.02, 6);
  });
});

describe("estimateSavingsUsd", () => {
  it("multiplies excess hours by the instantaneous burn rate", () => {
    const out = estimateSavingsUsd({
      actual: { requests: 20_000_000, cpuMs: 60_000_000 },
      hoursSavedEstimate: 24,
      periodHours: 24 * 30,
    });
    expect(out).toBeGreaterThan(0);
  });
});
