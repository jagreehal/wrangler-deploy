import { describe, it, expect } from "vitest";
import { shouldSuppress } from "./cooldown.js";

const now = new Date("2026-04-17T12:00:00Z");

describe("shouldSuppress", () => {
  it("no row -> not suppressed", () => {
    expect(shouldSuppress({ row: null, now }).suppressed).toBe(false);
  });

  it("cooldown in the future -> suppressed with reason cooldown", () => {
    const r = {
      breachKey: "k", accountId: "a", scriptName: "s", breachType: "requests" as const,
      firstSeenAt: "", lastSeenAt: "",
      cooldownUntil: "2026-04-17T13:00:00Z",
      graceUntil: null, workflowInstanceId: null,
    };
    const out = shouldSuppress({ row: r, now });
    expect(out.suppressed).toBe(true);
    if (out.suppressed) expect(out.reason).toBe("cooldown");
  });

  it("grace in the future -> suppressed with reason grace (takes precedence over expired cooldown)", () => {
    const r = {
      breachKey: "k", accountId: "a", scriptName: "s", breachType: "requests" as const,
      firstSeenAt: "", lastSeenAt: "",
      cooldownUntil: "2026-04-17T11:00:00Z",
      graceUntil: "2026-04-17T13:00:00Z",
      workflowInstanceId: null,
    };
    const out = shouldSuppress({ row: r, now });
    expect(out.suppressed).toBe(true);
    if (out.suppressed) expect(out.reason).toBe("grace");
  });

  it("cooldown + grace in the past -> not suppressed", () => {
    const r = {
      breachKey: "k", accountId: "a", scriptName: "s", breachType: "requests" as const,
      firstSeenAt: "", lastSeenAt: "",
      cooldownUntil: "2026-04-17T11:00:00Z",
      graceUntil: "2026-04-17T11:30:00Z",
      workflowInstanceId: null,
    };
    expect(shouldSuppress({ row: r, now }).suppressed).toBe(false);
  });
});
