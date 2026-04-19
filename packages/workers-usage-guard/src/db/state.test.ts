import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import { getOverageState, upsertOverageStateOnBreach, setGraceUntil, setWorkflowInstanceId } from "./state.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.first.mockResolvedValue(null as unknown as never);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  return { db, stmt };
}

describe("overage_state helpers", () => {
  it("getOverageState returns null when not found", async () => {
    const { db, stmt } = mkDb();
    stmt.first.mockResolvedValue(null as unknown as never);
    const r = await getOverageState({ breachKey: "k" }, { db });
    expect(r).toBeNull();
  });

  it("upsertOverageStateOnBreach inserts first seen and sets cooldown", async () => {
    const { db, stmt } = mkDb();
    const now = new Date("2026-04-17T12:00:00Z");
    await upsertOverageStateOnBreach(
      {
        accountId: "a",
        scriptName: "s",
        breachType: "requests",
        cooldownSeconds: 3600,
        now,
      },
      { db }
    );
    const bindCall = stmt.bind.mock.calls[0]!;
    expect(bindCall[0]).toBe("a:s:requests");
    expect(bindCall[5]).toBe(new Date(now.getTime() + 3_600_000).toISOString());
    // Verify unused params are acceptable; suppress noUnusedLocals on 'db' in test scope.
    void db;
  });

  it("setGraceUntil updates by breach_key", async () => {
    const { db, stmt } = mkDb();
    await setGraceUntil({ breachKey: "a:s:requests", graceUntil: "2026-04-17T16:00:00Z" }, { db });
    expect(db.prepare).toHaveBeenCalled();
    expect(stmt.bind).toHaveBeenCalledWith("2026-04-17T16:00:00Z", "a:s:requests");
  });

  it("setWorkflowInstanceId binds the provided id", async () => {
    const { db, stmt } = mkDb();
    await setWorkflowInstanceId({ breachKey: "a:s:requests", workflowInstanceId: "wf-1" }, { db });
    expect(stmt.bind).toHaveBeenCalledWith("wf-1", "a:s:requests");
  });
});
