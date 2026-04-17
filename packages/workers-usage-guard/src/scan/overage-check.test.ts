import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { runOverageCheck, type OverageCheckDeps } from "./overage-check.js";
import { stubs } from "../test-utils/stubs.js";

function mkDeps(): OverageCheckDeps {
  const d = mock<OverageCheckDeps>();
  const m = d as unknown as Record<string, unknown>;
  m["now"] = () => new Date("2026-04-17T12:00:00Z");
  m["id"] = () => "id-1";
  m["fetchUsage"] = vi.fn().mockResolvedValue({
    raw: { data: {} },
    rows: [{ scriptName: "api", requests: 2_000_000, cpuMs: 0 }],
  });
  m["getState"] = vi.fn().mockResolvedValue(null);
  m["upsertOnBreach"] = vi.fn().mockResolvedValue("a:api:requests");
  m["setWorkflowInstanceId"] = vi.fn().mockResolvedValue(undefined);
  m["insertSnapshot"] = vi.fn().mockResolvedValue(undefined);
  m["appendActivity"] = vi.fn().mockResolvedValue(undefined);
  m["createWorkflow"] = vi.fn().mockResolvedValue({ id: "wf-1" });
  m["isProtected"] = vi.fn().mockReturnValue(false);
  m["loadRuntimeProtectedSet"] = vi.fn().mockResolvedValue(new Set<string>());
  return d as unknown as OverageCheckDeps;
}

describe("runOverageCheck", () => {
  it("creates a workflow for each non-suppressed breach", async () => {
    const d = mkDeps();
    const account = stubs.accountConfig({
      accountId: "a",
      workers: [stubs.workerConfig({ scriptName: "api", thresholds: { requests: 1_000_000 } })],
    });
    await runOverageCheck(
      {
        accounts: [account],
        defaults: { requests: 1_000_000, cpuMs: 100, costUsd: 999 },
        cooldownSeconds: 3600,
      },
      d
    );
    expect(d.createWorkflow).toHaveBeenCalledTimes(1);
  });

  it("skips protected scripts and logs suppression", async () => {
    const d = mkDeps();
    (d.isProtected as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(true);
    const account = stubs.accountConfig({
      workers: [stubs.workerConfig({ scriptName: "api", thresholds: { requests: 1 } })],
    });
    await runOverageCheck(
      { accounts: [account], defaults: { requests: 1, cpuMs: 100, costUsd: 999 }, cooldownSeconds: 3600 },
      d
    );
    expect(d.createWorkflow).not.toHaveBeenCalled();
    expect(d.appendActivity).toHaveBeenCalled();
  });

  it("skips scripts in the runtime-protected set", async () => {
    const d = mkDeps();
    (d as unknown as Record<string, unknown>)["loadRuntimeProtectedSet"] = vi.fn().mockResolvedValue(new Set(["a:api"]));
    (d.isProtected as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      (args: { account: { accountId: string }; scriptName: string; runtimeProtected?: Set<string> }) =>
        Boolean(args.runtimeProtected?.has(`${args.account.accountId}:${args.scriptName}`))
    );
    const account = stubs.accountConfig({
      accountId: "a",
      workers: [stubs.workerConfig({ scriptName: "api", thresholds: { requests: 1 } })],
    });
    await runOverageCheck(
      { accounts: [account], defaults: { requests: 1, cpuMs: 100, costUsd: 999 }, cooldownSeconds: 3600 },
      d
    );
    expect(d.createWorkflow).not.toHaveBeenCalled();
  });

  it("respects cooldown — no workflow created", async () => {
    const d = mkDeps();
    (d.getState as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      breachKey: "a:api:requests",
      accountId: "a", scriptName: "api", breachType: "requests" as const,
      firstSeenAt: "", lastSeenAt: "",
      cooldownUntil: "2026-04-17T13:00:00Z",
      graceUntil: null, workflowInstanceId: null,
    });
    const account = stubs.accountConfig({
      workers: [stubs.workerConfig({ scriptName: "api", thresholds: { requests: 1 } })],
    });
    await runOverageCheck(
      { accounts: [account], defaults: { requests: 1, cpuMs: 100, costUsd: 999 }, cooldownSeconds: 3600 },
      d
    );
    expect(d.createWorkflow).not.toHaveBeenCalled();
  });

  it("creates a workflow when forecast projects over threshold even if current is below", async () => {
    const d = mkDeps();
    d.fetchUsage = vi.fn().mockResolvedValue({
      raw: {},
      rows: [{ scriptName: "api", requests: 600_000, cpuMs: 0 }],
    }) as unknown as OverageCheckDeps["fetchUsage"];
    d.now = () => new Date("2026-04-17T00:01:00Z");
    const account = stubs.accountConfig({
      accountId: "a",
      billingCycleDay: 17,
      workers: [
        stubs.workerConfig({
          scriptName: "api",
          thresholds: { requests: 1_000_000 },
          forecast: true,
          forecastLookaheadSeconds: 60,
        }),
      ],
    });
    await runOverageCheck(
      {
        accounts: [account],
        defaults: { requests: 999_999_999, cpuMs: 100, costUsd: 999 },
        cooldownSeconds: 3600,
      },
      d
    );
    expect(d.createWorkflow).toHaveBeenCalledTimes(1);
    const call = (d.createWorkflow as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const params = (call[0] as { params: { ruleId: string } }).params;
    expect(params.ruleId.startsWith("forecast:")).toBe(true);
  });

  it("does not fire forecast breach when worker.forecast is false", async () => {
    const d = mkDeps();
    d.fetchUsage = vi.fn().mockResolvedValue({
      raw: {},
      rows: [{ scriptName: "api", requests: 600_000, cpuMs: 0 }],
    }) as unknown as OverageCheckDeps["fetchUsage"];
    d.now = () => new Date("2026-04-17T00:01:00Z");
    const account = stubs.accountConfig({
      accountId: "a",
      billingCycleDay: 17,
      workers: [
        stubs.workerConfig({
          scriptName: "api",
          thresholds: { requests: 1_000_000 },
          forecast: false,
        }),
      ],
    });
    await runOverageCheck(
      {
        accounts: [account],
        defaults: { requests: 999_999_999, cpuMs: 100, costUsd: 999 },
        cooldownSeconds: 3600,
      },
      d
    );
    expect(d.createWorkflow).not.toHaveBeenCalled();
  });
});
