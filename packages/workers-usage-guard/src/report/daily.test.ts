import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { runDailyReport, type DailyReportDeps } from "./daily.js";
import { stubs } from "../test-utils/stubs.js";

function mkDeps(): DailyReportDeps {
  const d = mock<DailyReportDeps>() as unknown as Record<string, unknown>;
  d.now = () => new Date("2026-04-17T08:00:00Z");
  d.id = () => "r-1";
  d.fetchUsage = vi.fn().mockResolvedValue({
    raw: {},
    rows: [
      { scriptName: "api", requests: 11_000_000, cpuMs: 31_000_000 },
      { scriptName: "worker-2", requests: 100, cpuMs: 100 },
    ],
  });
  d.insertReport = vi.fn().mockResolvedValue(undefined);
  d.dispatch = vi.fn().mockResolvedValue([]);
  return d as unknown as DailyReportDeps;
}

describe("runDailyReport", () => {
  it("sorts per-worker by cost and inserts a report row", async () => {
    const d = mkDeps();
    const account = stubs.accountConfig({
      workers: [stubs.workerConfig({ scriptName: "api" }), stubs.workerConfig({ scriptName: "worker-2" })],
    });
    await runDailyReport({ accounts: [account] }, d);
    expect(d.insertReport).toHaveBeenCalledTimes(1);
    const call = (d.insertReport as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const report = (call[0] as { report: { payload: { perWorker: Array<{ scriptName: string }> } } }).report;
    expect(report.payload.perWorker[0]!.scriptName).toBe("api");
  });

  it("dispatches daily-report event", async () => {
    const d = mkDeps();
    const account = stubs.accountConfig();
    await runDailyReport({ accounts: [account] }, d);
    expect(d.dispatch).toHaveBeenCalled();
  });
});
