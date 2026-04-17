import { describe, it, expect } from "vitest";
import { renderStatusTable, renderStatusJson } from "./render-table.js";
import type { StatusRow } from "./status.js";

const rows: StatusRow[] = [
  {
    accountId: "a",
    scriptName: "api",
    requests: 11_000_000,
    cpuMs: 31_000_000,
    estimatedCostUsd: 0.32,
    periodStart: "2026-04-01T00:00:00.000Z",
    periodEnd: "2026-04-30T23:59:59.000Z",
  },
  {
    accountId: "a",
    scriptName: "worker-2",
    requests: 100,
    cpuMs: 100,
    estimatedCostUsd: 0,
    periodStart: "2026-04-01T00:00:00.000Z",
    periodEnd: "2026-04-30T23:59:59.000Z",
  },
];

describe("renderStatusTable", () => {
  it("includes a header and one row per input", () => {
    const out = renderStatusTable(rows);
    expect(out).toContain("SCRIPT");
    expect(out).toContain("REQUESTS");
    expect(out).toContain("CPU_MS");
    expect(out).toContain("EST_USD");
    expect(out).toContain("api");
    expect(out).toContain("worker-2");
  });

  it("formats large numbers with commas", () => {
    const out = renderStatusTable(rows);
    expect(out).toContain("11,000,000");
  });

  it("renders empty input as an empty-data notice, not a crash", () => {
    const out = renderStatusTable([]);
    expect(out).toMatch(/no data|empty/i);
  });
});

describe("renderStatusJson", () => {
  it("returns parseable JSON with all rows", () => {
    const parsed = JSON.parse(renderStatusJson(rows));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].scriptName).toBe("api");
  });
});
