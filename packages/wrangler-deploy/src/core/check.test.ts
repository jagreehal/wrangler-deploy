import { describe, expect, it } from "vitest";
import { evaluateCheck } from "./check.js";

const pass = [{ name: "ok", status: "pass" as const, message: "ok" }];
const fail = [{ name: "bad", status: "fail" as const, message: "bad" }];

describe("evaluateCheck", () => {
  it("fails full pack when doctor fails", () => {
    const result = evaluateCheck({ pack: "full", checks: fail, plan: { stage: "s", items: [] } });
    expect(result.ok).toBe(false);
    expect(result.doctorOk).toBe(false);
  });

  it("fails plan-only pack on drift or orphaned items", () => {
    const result = evaluateCheck({
      pack: "plan-only",
      checks: pass,
      plan: { stage: "s", items: [{ resource: "cache", type: "kv", action: "drifted", name: "cache" }] },
    });
    expect(result.ok).toBe(false);
    expect(result.planOk).toBe(false);
  });

  it("passes full pack with clean doctor and plan", () => {
    const result = evaluateCheck({ pack: "full", checks: pass, plan: { stage: "s", items: [] } });
    expect(result).toMatchObject({ ok: true, doctorOk: true, planOk: true });
  });
});
