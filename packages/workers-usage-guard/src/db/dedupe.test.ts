import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import { isDeduped, recordDedupe } from "./dedupe.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  stmt.first.mockResolvedValue(null as unknown as never);
  return { db, stmt };
}

describe("dedupe", () => {
  it("isDeduped returns false when no row within window", async () => {
    const { db, stmt } = mkDb();
    stmt.first.mockResolvedValue(null as unknown as never);
    const out = await isDeduped({ dedupKey: "k", channelName: "c", windowSeconds: 60 }, { db });
    expect(out).toBe(false);
  });

  it("isDeduped returns true when row present", async () => {
    const { db, stmt } = mkDb();
    stmt.first.mockResolvedValue({ sent_at: "t" } as unknown as never);
    const out = await isDeduped({ dedupKey: "k", channelName: "c", windowSeconds: 60 }, { db });
    expect(out).toBe(true);
  });

  it("recordDedupe binds key, channel, sent_at", async () => {
    const { db, stmt } = mkDb();
    await recordDedupe({ dedupKey: "k", channelName: "c", now: new Date("2026-04-17T12:00:00Z") }, { db });
    expect(stmt.bind).toHaveBeenCalledWith("k", "c", "2026-04-17T12:00:00.000Z");
  });
});
