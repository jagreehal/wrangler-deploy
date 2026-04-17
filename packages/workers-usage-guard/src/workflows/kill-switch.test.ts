// src/workflows/kill-switch.test.ts
import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import {
  stepProtectedCheck,
  stepCaptureForensics,
  stepDetachRoutes,
  stepDetachDomains,
  stepDisableWorkersDev,
  stepNotify,
  stepLogActivity,
  stepSetGrace,
  stepAwaitApproval,
  type StepDeps,
} from "./kill-switch.js";
import { stubs } from "../test-utils/stubs.js";

function mkDeps(): StepDeps {
  const d = mock<StepDeps>() as unknown as Record<string, unknown>;
  d.now = () => new Date("2026-04-17T12:00:00Z");
  d.id = () => "id-1";
  d.detachRoutes = vi.fn().mockResolvedValue([{ zoneId: "z1", routeId: "r1", pattern: "a.com/*" }]);
  d.detachDomains = vi.fn().mockResolvedValue(["api.example.com"]);
  d.disableWorkersDev = vi.fn().mockResolvedValue(undefined);
  d.insertForensic = vi.fn().mockResolvedValue(undefined);
  d.completeForensic = vi.fn().mockResolvedValue(undefined);
  d.appendActivity = vi.fn().mockResolvedValue(undefined);
  d.setGraceUntil = vi.fn().mockResolvedValue(undefined);
  d.dispatch = vi.fn().mockResolvedValue([{ ok: true, channel: "x", sentAt: "t", dedupKey: "d" }]);
  d.isProtected = vi.fn().mockReturnValue(false);
  d.loadRuntimeProtectedSet = vi.fn().mockResolvedValue(new Set<string>()) as unknown as StepDeps["loadRuntimeProtectedSet"];
  return d as unknown as StepDeps;
}

const params = {
  accountId: "a",
  scriptName: "api",
  breachType: "requests" as const,
  ruleId: "request-flood",
  actual: 2_000_000,
  limit: 1_000_000,
  breachKey: "a:api:requests",
  periodStart: "2026-04-01T00:00:00Z",
  periodEnd: "2026-04-30T23:59:59Z",
  zones: [{ zoneId: "z1" }],
};

describe("kill-switch steps", () => {
  it("stepProtectedCheck short-circuits when protected", async () => {
    const d = mkDeps();
    (d.isProtected as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue(true);
    const out = await stepProtectedCheck(
      {
        accountId: "a",
        scriptName: "api",
        guardScriptName: "g",
        account: stubs.accountConfig({ accountId: "a", workers: [stubs.workerConfig({ scriptName: "api", protected: true })] }),
        breachKey: "k",
        workflowInstanceId: "w",
        runtimeProtected: new Set<string>(),
      },
      d
    );
    expect(out.proceed).toBe(false);
    expect(d.appendActivity).toHaveBeenCalled();
  });

  it("stepCaptureForensics inserts a forensic row", async () => {
    const d = mkDeps();
    await stepCaptureForensics(
      { params, workflowInstanceId: "w-1", graphqlResponse: { data: {} } },
      d
    );
    expect(d.insertForensic).toHaveBeenCalled();
  });

  it("stepDetachRoutes returns the list and delegates", async () => {
    const d = mkDeps();
    const out = await stepDetachRoutes({ params }, d);
    expect(out).toEqual([{ zoneId: "z1", routeId: "r1", pattern: "a.com/*" }]);
  });

  it("stepDetachDomains returns detached hostnames", async () => {
    const d = mkDeps();
    const out = await stepDetachDomains({ params }, d);
    expect(out).toEqual(["api.example.com"]);
  });

  it("stepDisableWorkersDev delegates to Cloudflare subdomain API adapter", async () => {
    const d = mkDeps();
    await stepDisableWorkersDev({ params }, d);
    expect(d.disableWorkersDev).toHaveBeenCalledWith({ accountId: "a", scriptName: "api" });
  });

  it("stepNotify dispatches a breach event and returns results", async () => {
    const d = mkDeps();
    const out = await stepNotify(
      {
        breachForensic: stubs.breachForensic(),
        actions: stubs.killSwitchActions(),
        severity: "critical",
      },
      d
    );
    expect(out).toHaveLength(1);
    expect(d.dispatch).toHaveBeenCalled();
  });

  it("stepLogActivity records route and domain detachments separately", async () => {
    const d = mkDeps();
    await stepLogActivity(
      {
        workflowInstanceId: "w",
        accountId: "a",
        scriptName: "api",
        removedRoutes: [{ zoneId: "z1", routeId: "r1", pattern: "a.com/*" }],
        removedDomains: ["api.example.com"],
      },
      d
    );
    const calls = (d.appendActivity as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("stepSetGrace sets grace_until to now + graceSeconds", async () => {
    const d = mkDeps();
    await stepSetGrace({ breachKey: "a:api:requests", graceSeconds: 14_400 }, d);
    const call = (d.setGraceUntil as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((call[0] as { graceUntil: string }).graceUntil).toBe("2026-04-17T16:00:00.000Z");
  });

  it("stepProtectedCheck respects runtime-protected set", async () => {
    const d = mkDeps();
    (d.isProtected as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      (args: { account: { accountId: string }; scriptName: string; runtimeProtected?: Set<string> }) =>
        Boolean(args.runtimeProtected?.has(`${args.account.accountId}:${args.scriptName}`))
    );
    const out = await stepProtectedCheck(
      {
        accountId: "a",
        scriptName: "api",
        guardScriptName: "g",
        account: stubs.accountConfig({ accountId: "a", workers: [stubs.workerConfig({ scriptName: "api" })] }),
        breachKey: "k",
        workflowInstanceId: "w",
        runtimeProtected: new Set(["a:api"]),
      },
      d
    );
    expect(out.proceed).toBe(false);
  });

  it("stepAwaitApproval notifies using the created approval id and returns approved", async () => {
    const d = mkDeps();
    const createApproval = vi.fn().mockResolvedValue("appr-123");
    const getApproval = vi
      .fn()
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "approved" });
    const dispatchApprovalNotification = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await stepAwaitApproval(
      {
        accountId: "a",
        scriptName: "api",
        breachKey: "a:api:requests",
        workflowInstanceId: "wf-1",
        ruleId: "request-flood",
        breachType: "requests",
        actualValue: 600_000,
        limitValue: 500_000,
        approvalTimeoutSeconds: 3600,
        pollIntervalSeconds: 1,
        sleep,
      },
      {
        ...d,
        createApproval,
        getApproval,
        expireApproval: vi.fn().mockResolvedValue(undefined),
        dispatchApprovalNotification,
      }
    );

    expect(result.decision).toBe("approved");
    expect(createApproval).toHaveBeenCalled();
    expect(dispatchApprovalNotification).toHaveBeenCalledWith("id-1");
  });

  it("stepAwaitApproval returns expired when deadline is reached", async () => {
    let nowMs = Date.parse("2026-04-17T12:00:00Z");
    const deps = {
      ...mkDeps(),
      now: () => new Date(nowMs),
      createApproval: vi.fn().mockResolvedValue("appr-1"),
      getApproval: vi.fn().mockResolvedValue({ status: "pending" }),
      expireApproval: vi.fn().mockResolvedValue(undefined),
      dispatchApprovalNotification: vi.fn().mockResolvedValue(undefined),
    };
    const sleep = vi.fn().mockImplementation(async () => {
      nowMs += 31_000;
    });

    const result = await stepAwaitApproval(
      {
        accountId: "a",
        scriptName: "api",
        breachKey: "a:api:requests",
        workflowInstanceId: "wf-1",
        ruleId: "request-flood",
        breachType: "requests",
        actualValue: 600_000,
        limitValue: 500_000,
        approvalTimeoutSeconds: 30,
        pollIntervalSeconds: 30,
        sleep,
      },
      deps
    );

    expect(result.decision).toBe("expired");
    expect(deps.expireApproval).toHaveBeenCalledWith({ id: "id-1" });
  });

  it("stepAwaitApproval returns approved when approval arrives between last poll and deadline", async () => {
    let nowMs = Date.parse("2026-04-17T12:00:00Z");
    let getApprovalCallCount = 0;
    const deps = {
      ...mkDeps(),
      now: () => new Date(nowMs),
      createApproval: vi.fn().mockResolvedValue("appr-1"),
      getApproval: vi.fn().mockImplementation(async () => {
        getApprovalCallCount += 1;
        // First poll: still pending; final read after deadline: approved
        return getApprovalCallCount === 1 ? { status: "pending" } : { status: "approved" };
      }),
      expireApproval: vi.fn().mockResolvedValue(undefined),
      dispatchApprovalNotification: vi.fn().mockResolvedValue(undefined),
    };
    const sleep = vi.fn().mockImplementation(async () => {
      nowMs += 31_000; // push past 30s deadline
    });

    const result = await stepAwaitApproval(
      {
        accountId: "a",
        scriptName: "api",
        breachKey: "a:api:requests",
        workflowInstanceId: "wf-1",
        ruleId: "request-flood",
        breachType: "requests",
        actualValue: 600_000,
        limitValue: 500_000,
        approvalTimeoutSeconds: 30,
        pollIntervalSeconds: 30,
        sleep,
      },
      deps
    );

    expect(result.decision).toBe("approved");
    expect(deps.expireApproval).not.toHaveBeenCalled();
  });
});
