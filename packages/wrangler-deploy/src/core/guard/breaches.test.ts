import { describe, it, expect, vi } from "vitest";
import { runBreaches, renderBreachesTable, renderBreachesJson, type BreachesRunnerDeps } from "./breaches.js";
import type { BreachForensic } from "../../usage-guard-shared/index.js";

const breach: BreachForensic = {
  id: "f-1",
  breachKey: "a:api:requests",
  workflowInstanceId: "wf-1",
  triggeredAt: "2026-04-17T12:00:00.000Z",
  ruleId: "request-flood",
  graphqlResponse: {},
  actionsTaken: { removedRoutes: [{ zoneId: "z1", routeId: "r1", pattern: "a.com/*" }], removedDomains: ["api.example.com"] },
  estimatedSavingsUsd: 1.23,
};

function mkDeps(rows: BreachForensic[] = [breach]): BreachesRunnerDeps {
  return {
    client: {
      get: vi.fn(async () => ({ breaches: rows })) as unknown as BreachesRunnerDeps["client"]["get"],
    },
  };
}

describe("runBreaches", () => {
  it("calls /api/breaches with account and limit in the query", async () => {
    const deps = mkDeps();
    const out = await runBreaches({ accountId: "a", limit: 20 }, deps);
    expect(out).toHaveLength(1);
    const call = (deps.client.get as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe("/api/breaches?account=a&limit=20");
  });

  it("returns empty list when API returns none", async () => {
    const deps = mkDeps([]);
    const out = await runBreaches({ accountId: "a", limit: 10 }, deps);
    expect(out).toEqual([]);
  });
});

describe("renderBreachesTable", () => {
  it("includes triggeredAt, breachKey, ruleId, actions count, savings", () => {
    const out = renderBreachesTable([breach]);
    expect(out).toContain("TRIGGERED_AT");
    expect(out).toContain("BREACH_KEY");
    expect(out).toContain("RULE");
    expect(out).toContain("ACTIONS");
    expect(out).toContain("EST_SAVINGS");
    expect(out).toContain("a:api:requests");
    expect(out).toContain("request-flood");
    expect(out).toContain("$1.23");
  });

  it("shows (no data) for empty input", () => {
    expect(renderBreachesTable([])).toMatch(/no data/i);
  });
});

describe("renderBreachesJson", () => {
  it("returns parseable JSON", () => {
    const parsed = JSON.parse(renderBreachesJson([breach]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].breachKey).toBe("a:api:requests");
  });
});
