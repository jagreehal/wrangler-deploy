// packages/wrangler-deploy/src/core/guard/report.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  runReport,
  renderReportText,
  renderReportJson,
  type ReportRunnerDeps,
} from "./report.js";
import type { UsageReport } from "../../usage-guard-shared/index.js";

const report: UsageReport = {
  id: "r-1",
  accountId: "a",
  billingPeriodStart: "2026-04-01T00:00:00.000Z",
  billingPeriodEnd: "2026-04-30T23:59:59.000Z",
  generatedAt: "2026-04-17T08:00:00.000Z",
  payload: {
    perWorker: [
      { scriptName: "api", requests: 11_000_000, cpuMs: 31_000_000, estimatedCostUsd: 0.32 },
      { scriptName: "worker-2", requests: 100, cpuMs: 100, estimatedCostUsd: 0 },
    ],
    totals: { requests: 11_000_100, cpuMs: 31_000_100, estimatedCostUsd: 0.32 },
    savingsThisMonthUsd: 2.5,
  },
};

function mkDeps(rows: UsageReport[] = [report]): ReportRunnerDeps {
  return {
    client: {
      get: vi.fn(async () => ({ reports: rows })) as unknown as ReportRunnerDeps["client"]["get"],
    },
  };
}

describe("runReport", () => {
  it("returns the most recent report when no date filter", async () => {
    const deps = mkDeps();
    const out = await runReport({ accountId: "a" }, deps);
    expect(out?.id).toBe("r-1");
  });

  it("filters by generatedAt date when date supplied", async () => {
    const r2: UsageReport = { ...report, id: "r-2", generatedAt: "2026-04-16T08:00:00.000Z" };
    const deps = mkDeps([report, r2]);
    const out = await runReport({ accountId: "a", date: "2026-04-16" }, deps);
    expect(out?.id).toBe("r-2");
  });

  it("returns null when no report found for the date", async () => {
    const deps = mkDeps();
    const out = await runReport({ accountId: "a", date: "2020-01-01" }, deps);
    expect(out).toBeNull();
  });
});

describe("renderReportText", () => {
  it("renders headline totals and per-worker rows", () => {
    const out = renderReportText(report);
    expect(out).toContain("2026-04-01");
    expect(out).toContain("Total: 11,000,100 requests");
    expect(out).toContain("Savings this month: $2.50");
    expect(out).toContain("api");
    expect(out).toContain("$0.32");
  });

  it("renders (no report) for null", () => {
    expect(renderReportText(null)).toMatch(/no report/i);
  });
});

describe("renderReportJson", () => {
  it("JSON-serializes the report", () => {
    const parsed = JSON.parse(renderReportJson(report));
    expect(parsed.id).toBe("r-1");
  });

  it("returns {} for null", () => {
    expect(renderReportJson(null)).toBe("null");
  });
});
