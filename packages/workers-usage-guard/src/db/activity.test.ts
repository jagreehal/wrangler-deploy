import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import { appendActivity, makeLogger } from "./activity.js";
import { stubs } from "../test-utils/stubs.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  return { db, stmt };
}

describe("activity", () => {
  it("appendActivity stringifies details", async () => {
    const { db, stmt } = mkDb();
    const e = stubs.activityEvent({ details: { a: 1 } });
    await appendActivity({ event: e }, { db });
    const call = stmt.bind.mock.calls[0]!;
    expect(call[6]).toBe(JSON.stringify({ a: 1 }));
  });

  it("makeLogger injects id and now", async () => {
    const { db, stmt } = mkDb();
    const log = makeLogger(
      { actor: "cron:5min", nowFn: () => new Date("2026-04-17T12:00:00Z"), idFn: () => "id-1" },
      { db }
    );
    await log({ action: "breach_detected", resourceType: "worker", resourceId: "api", details: null });
    const call = stmt.bind.mock.calls[0]!;
    expect(call[0]).toBe("id-1");
    expect(call[1]).toBe("2026-04-17T12:00:00.000Z");
  });
});
