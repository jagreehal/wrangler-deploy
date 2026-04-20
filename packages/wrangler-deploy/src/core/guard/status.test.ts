import { describe, it, expect, vi } from "vitest";
import { runStatus, type StatusDeps, type StatusRow } from "./status.js";
import type { AccountConfig } from "../../usage-guard-shared/index.js";

function mkDeps(): StatusDeps {
  return {
    now: () => new Date("2026-04-17T12:00:00Z"),
    fetchUsage: vi.fn().mockResolvedValue({
      raw: {},
      rows: [
        { scriptName: "api", requests: 11_000_000, cpuMs: 31_000_000 },
        { scriptName: "worker-2", requests: 100, cpuMs: 100 },
      ],
    }),
  };
}

describe("runStatus", () => {
  it("returns one row per account × worker, with estimated cost", async () => {
    const account: AccountConfig = {
      accountId: "a",
      billingCycleDay: 1,
      workers: [
        { scriptName: "api" },
        { scriptName: "worker-2" },
      ],
      globalProtected: [],
    };
    const rows: StatusRow[] = await runStatus({ accounts: [account] }, mkDeps());
    expect(rows).toHaveLength(2);
    const api = rows.find((r) => r.scriptName === "api")!;
    expect(api.accountId).toBe("a");
    expect(api.requests).toBe(11_000_000);
    expect(api.cpuMs).toBe(31_000_000);
    expect(api.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("fills zero usage for workers missing from GraphQL response", async () => {
    const deps: StatusDeps = {
      ...mkDeps(),
      fetchUsage: vi.fn().mockResolvedValue({ raw: {}, rows: [] }),
    };
    const account: AccountConfig = {
      accountId: "a",
      billingCycleDay: 1,
      workers: [{ scriptName: "api" }],
      globalProtected: [],
    };
    const rows = await runStatus({ accounts: [account] }, deps);
    expect(rows).toEqual([
      {
        accountId: "a",
        scriptName: "api",
        requests: 0,
        cpuMs: 0,
        estimatedCostUsd: 0,
        periodStart: expect.any(String),
        periodEnd: expect.any(String),
      },
    ]);
  });

  it("skips accounts with no configured workers", async () => {
    const deps = mkDeps();
    const rows = await runStatus(
      {
        accounts: [
          { accountId: "empty", billingCycleDay: 1, workers: [], globalProtected: [] },
        ],
      },
      deps
    );
    expect(rows).toEqual([]);
    expect(deps.fetchUsage).not.toHaveBeenCalled();
  });

  it("overlays recentBreaches when a guard client is provided", async () => {
    const deps: StatusDeps = {
      now: () => new Date("2026-04-17T12:00:00Z"),
      fetchUsage: vi.fn().mockResolvedValue({
        raw: {},
        rows: [{ scriptName: "api", requests: 1, cpuMs: 1 }],
      }),
      breachClient: {
        get: vi.fn(async () => ({
          breaches: [
            {
              id: "f-1",
              breachKey: "a:api:requests",
              workflowInstanceId: "wf-1",
              triggeredAt: "2026-04-17T11:00:00.000Z",
              ruleId: "request-flood",
              graphqlResponse: {},
              actionsTaken: null,
              estimatedSavingsUsd: null,
            },
          ],
        })) as unknown as <T>(path: string) => Promise<T>,
      },
    };
    const account: AccountConfig = {
      accountId: "a",
      billingCycleDay: 1,
      workers: [{ scriptName: "api" }],
      globalProtected: [],
    };
    const rows = await runStatus({ accounts: [account] }, deps);
    expect(rows[0]?.recentBreaches).toHaveLength(1);
    expect(rows[0]?.recentBreaches?.[0]?.ruleId).toBe("request-flood");
  });

  it("omits recentBreaches when no client is provided (existing default behavior)", async () => {
    const account: AccountConfig = {
      accountId: "a",
      billingCycleDay: 1,
      workers: [{ scriptName: "api" }],
      globalProtected: [],
    };
    const rows = await runStatus({ accounts: [account] }, mkDeps());
    expect(rows[0]?.recentBreaches).toBeUndefined();
  });
});
