import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import { insertBreachForensic, completeBreachForensic } from "./forensics.js";
import { stubs } from "../test-utils/stubs.js";

function mkDb() {
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  return { db, stmt };
}

describe("breach_forensics", () => {
  it("inserts with stringified graphql response", async () => {
    const { db, stmt } = mkDb();
    const f = stubs.breachForensic({ graphqlResponse: { data: { hi: 1 } } });
    await insertBreachForensic({ forensic: f }, { db });
    const call = stmt.bind.mock.calls[0]!;
    expect(call[5]).toBe(JSON.stringify({ data: { hi: 1 } }));
  });

  it("completes a forensic row with actions and savings", async () => {
    const { db, stmt } = mkDb();
    await completeBreachForensic(
      { id: "f-1", actions: stubs.killSwitchActions(), estimatedSavingsUsd: 42 },
      { db }
    );
    expect(stmt.bind).toHaveBeenCalled();
  });
});
