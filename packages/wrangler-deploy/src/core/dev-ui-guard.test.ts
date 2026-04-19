import { describe, it, expect } from "vitest";
import { renderGuardPage, type GuardPageData } from "./dev-ui-guard.js";
import type { StatusRow } from "./guard/status.js";
import type { BreachForensic, UsageReport } from "usage-guard-shared";
import type { RuntimeProtectedRow } from "./guard/runtime-protected-client.js";

const status: StatusRow[] = [
  {
    accountId: "a",
    scriptName: "api",
    requests: 11_000_000,
    cpuMs: 31_000_000,
    estimatedCostUsd: 0.32,
    periodStart: "2026-04-01T00:00:00.000Z",
    periodEnd: "2026-04-30T23:59:59.000Z",
  },
];

const breach: BreachForensic = {
  id: "f-1",
  breachKey: "a:api:requests",
  workflowInstanceId: "wf-1",
  triggeredAt: "2026-04-17T11:00:00.000Z",
  ruleId: "request-flood",
  graphqlResponse: {},
  actionsTaken: { removedRoutes: [], removedDomains: [] },
  estimatedSavingsUsd: 1.23,
};

const report: UsageReport = {
  id: "r-1",
  accountId: "a",
  billingPeriodStart: "2026-04-01T00:00:00.000Z",
  billingPeriodEnd: "2026-04-30T23:59:59.000Z",
  generatedAt: "2026-04-17T08:00:00.000Z",
  payload: {
    perWorker: [{ scriptName: "api", requests: 1, cpuMs: 1, estimatedCostUsd: 0.1 }],
    totals: { requests: 1, cpuMs: 1, estimatedCostUsd: 0.1 },
    savingsThisMonthUsd: 2.5,
  },
};

const rp: RuntimeProtectedRow = {
  accountId: "a",
  scriptName: "api",
  addedAt: "2026-04-17T00:00:00.000Z",
  addedBy: "cli:jag",
  reason: "oncall",
};

function baseData(): GuardPageData {
  return { status };
}

describe("renderGuardPage", () => {
  it("renders a valid HTML page with the usage section", () => {
    const html = renderGuardPage(baseData());
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Workers Usage Guard");
    expect(html).toContain("api");
    expect(html).toContain("11,000,000");
    expect(html).toContain("$0.32");
  });

  it("shows (no data) when status is empty", () => {
    const html = renderGuardPage({ status: [] });
    expect(html).toMatch(/\(no data\)/i);
  });

  it("renders breaches section only when provided", () => {
    const withoutBreaches = renderGuardPage(baseData());
    expect(withoutBreaches).not.toMatch(/recent breaches/i);

    const withBreaches = renderGuardPage({ ...baseData(), breaches: [breach] });
    expect(withBreaches).toMatch(/recent breaches/i);
    expect(withBreaches).toContain("request-flood");
  });

  it("renders report section only when provided", () => {
    const withReport = renderGuardPage({ ...baseData(), report });
    expect(withReport).toMatch(/latest report/i);
    expect(withReport).toContain("$2.50");
  });

  it("renders runtime-protected section only when provided", () => {
    const html = renderGuardPage({ ...baseData(), runtimeProtected: [rp] });
    expect(html).toMatch(/runtime-protected/i);
    expect(html).toContain("oncall");
  });

  it("escapes HTML in data", () => {
    const withScript = {
      ...baseData(),
      status: [{ ...status[0]!, scriptName: "<img onerror=alert(1)>" }],
    };
    const html = renderGuardPage(withScript);
    expect(html).not.toContain("<img onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });

  it("shows a warning banner when endpoint is not configured", () => {
    const html = renderGuardPage({ ...baseData(), endpointConfigured: false });
    expect(html).toMatch(/guard endpoint not configured/i);
  });
});
