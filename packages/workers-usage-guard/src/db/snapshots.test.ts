import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import { insertUsageSnapshot, listRecentSnapshots } from "./snapshots.js";
import { stubs } from "../test-utils/stubs.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  stmt.all.mockResolvedValue({ results: [] } as unknown as never);
  return { db, stmt };
}

describe("snapshots", () => {
  it("insertUsageSnapshot binds every column in order", async () => {
    const { db, stmt } = mkDb();
    const s = stubs.usageSnapshot();
    await insertUsageSnapshot({ snapshot: s }, { db });
    const call = stmt.bind.mock.calls[0]!;
    expect(call[0]).toBe(s.id);
    expect(call[6]).toBe(s.estimatedCostUsd);
  });

  it("listRecentSnapshots maps snake_case to camelCase", async () => {
    const { db, stmt } = mkDb();
    stmt.all.mockResolvedValue({
      results: [
        {
          id: "1",
          account_id: "a",
          script_name: "s",
          captured_at: "t",
          requests: 1,
          cpu_ms: 2,
          estimated_cost_usd: 3,
          period_start: "p1",
          period_end: "p2",
        },
      ],
    } as unknown as never);
    const out = await listRecentSnapshots({ accountId: "a", scriptName: "s", limit: 10 }, { db });
    expect(out[0]?.estimatedCostUsd).toBe(3);
    expect(out[0]?.cpuMs).toBe(2);
  });
});
