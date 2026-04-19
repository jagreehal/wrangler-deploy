import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import {
  addRuntimeProtection,
  removeRuntimeProtection,
  listRuntimeProtected,
  loadRuntimeProtectedSet,
} from "./runtime-protected.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  stmt.all.mockResolvedValue({ results: [] } as unknown as never);
  return { db, stmt };
}

describe("runtime-protected", () => {
  it("addRuntimeProtection binds account, script, timestamps", async () => {
    const { db, stmt } = mkDb();
    await addRuntimeProtection(
      { accountId: "a", scriptName: "api", addedBy: "cli:jag", reason: "oncall", now: new Date("2026-04-17T12:00:00Z") },
      { db }
    );
    const call = stmt.bind.mock.calls[0]!;
    expect(call[0]).toBe("a");
    expect(call[1]).toBe("api");
    expect(call[2]).toBe("2026-04-17T12:00:00.000Z");
    expect(call[3]).toBe("cli:jag");
    expect(call[4]).toBe("oncall");
  });

  it("addRuntimeProtection allows null reason", async () => {
    const { db, stmt } = mkDb();
    await addRuntimeProtection(
      { accountId: "a", scriptName: "api", addedBy: "cli:jag", now: new Date("2026-04-17T12:00:00Z") },
      { db }
    );
    const call = stmt.bind.mock.calls[0]!;
    expect(call[4]).toBeNull();
  });

  it("removeRuntimeProtection binds account and script only", async () => {
    const { db, stmt } = mkDb();
    await removeRuntimeProtection({ accountId: "a", scriptName: "api" }, { db });
    expect(stmt.bind).toHaveBeenCalledWith("a", "api");
  });

  it("listRuntimeProtected maps snake_case rows to camelCase", async () => {
    const { db, stmt } = mkDb();
    stmt.all.mockResolvedValue({
      results: [
        { account_id: "a", script_name: "api", added_at: "t", added_by: "cli:jag", reason: "oncall" },
      ],
    } as unknown as never);
    const out = await listRuntimeProtected({ accountId: "a" }, { db });
    expect(out[0]).toEqual({
      accountId: "a",
      scriptName: "api",
      addedAt: "t",
      addedBy: "cli:jag",
      reason: "oncall",
    });
  });

  it("loadRuntimeProtectedSet returns a Set keyed by accountId:scriptName", async () => {
    const { db, stmt } = mkDb();
    stmt.all.mockResolvedValue({
      results: [
        { account_id: "a", script_name: "api" },
        { account_id: "b", script_name: "worker-2" },
      ],
    } as unknown as never);
    const out = await loadRuntimeProtectedSet({ db });
    expect(out.has("a:api")).toBe(true);
    expect(out.has("b:worker-2")).toBe(true);
    expect(out.size).toBe(2);
  });
});
