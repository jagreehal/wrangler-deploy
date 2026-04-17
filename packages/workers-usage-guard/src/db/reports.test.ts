import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import { insertUsageReport } from "./reports.js";
import { stubs } from "../test-utils/stubs.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  return { db, stmt };
}

describe("usage_reports", () => {
  it("binds stringified payload", async () => {
    const { db, stmt } = mkDb();
    const r = stubs.usageReport();
    await insertUsageReport({ report: r }, { db });
    const call = stmt.bind.mock.calls[0]!;
    expect(call[5]).toBe(JSON.stringify(r.payload));
  });
});
