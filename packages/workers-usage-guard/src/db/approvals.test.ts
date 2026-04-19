import { describe, it, expect, vi } from "vitest";
import {
  createApproval,
  getApproval,
  listPendingApprovals,
  decideApproval,
  expireStaleApprovals,
} from "./approvals.js";

function mkDb() {
  return {
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({}),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
  } as unknown as D1Database;
}

describe("createApproval", () => {
  it("inserts a pending row and returns the id", async () => {
    const db = mkDb();
    const id = await createApproval({
      accountId: "a",
      scriptName: "api",
      breachKey: "a:api:requests",
      workflowInstanceId: "wf-1",
      ruleId: "request-flood",
      breachType: "requests",
      actualValue: 600_000,
      limitValue: 500_000,
      expiresInSeconds: 3600,
      id: "appr-1",
      now: new Date("2026-04-17T12:00:00Z"),
    }, { db });
    expect(id).toBe("appr-1");
  });

  it("generates a UUID when no id is provided", async () => {
    const db = mkDb();
    const id = await createApproval({
      accountId: "a",
      scriptName: "api",
      breachKey: "a:api:requests",
      workflowInstanceId: "wf-1",
      ruleId: "request-flood",
      breachType: "requests",
      actualValue: 600_000,
      limitValue: 500_000,
      expiresInSeconds: 3600,
    }, { db });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("getApproval", () => {
  it("returns null when not found", async () => {
    const db = mkDb();
    const result = await getApproval({ id: "missing" }, { db });
    expect(result).toBeNull();
  });

  it("returns a row when found", async () => {
    const db = mkDb();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: "a1",
        account_id: "a",
        script_name: "api",
        breach_key: "a:api:requests",
        workflow_instance_id: "wf-1",
        created_at: "2026-04-17T12:00:00Z",
        expires_at: "2026-04-17T13:00:00Z",
        status: "pending",
        decided_at: null,
        decided_by: null,
        rule_id: "request-flood",
        breach_type: "requests",
        actual_value: 600_000,
        limit_value: 500_000,
      }),
    });
    const result = await getApproval({ id: "a1" }, { db });
    expect(result).not.toBeNull();
    expect(result!.scriptName).toBe("api");
    expect(result!.status).toBe("pending");
  });
});

describe("listPendingApprovals", () => {
  it("returns pending rows for an account", async () => {
    const db = mkDb();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [
        {
          id: "a1",
          account_id: "a",
          script_name: "api",
          breach_key: "a:api:requests",
          workflow_instance_id: "wf-1",
          created_at: "2026-04-17T12:00:00Z",
          expires_at: "2026-04-17T13:00:00Z",
          status: "pending",
          decided_at: null,
          decided_by: null,
          rule_id: "r1",
          breach_type: "requests",
          actual_value: 600_000,
          limit_value: 500_000,
        },
      ]}),
    });
    const rows = await listPendingApprovals({ accountId: "a" }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scriptName).toBe("api");
  });

  it("returns empty array when no pending approvals", async () => {
    const db = mkDb();
    const rows = await listPendingApprovals({ accountId: "a" }, { db });
    expect(rows).toHaveLength(0);
  });
});

describe("decideApproval", () => {
  it("updates status and decided fields for approved", async () => {
    const db = mkDb();
    const bind = vi.fn().mockReturnThis();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind,
      run: vi.fn().mockResolvedValue({}),
    });
    await decideApproval({
      id: "a1",
      accountId: "a",
      decision: "approved",
      decidedBy: "cli:jag",
      now: new Date("2026-04-17T13:00:00Z"),
    }, { db });
    expect(bind).toHaveBeenCalledWith("approved", "2026-04-17T13:00:00.000Z", "cli:jag", "a1", "a");
  });

  it("updates status and decided fields for rejected", async () => {
    const db = mkDb();
    await decideApproval({
      id: "a1",
      accountId: "a",
      decision: "rejected",
      decidedBy: "cli:jag",
      now: new Date("2026-04-17T13:00:00Z"),
    }, { db });
  });
});

describe("expireStaleApprovals", () => {
  it("marks expired rows and returns count", async () => {
    const db = mkDb();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 2 } }),
    });
    const count = await expireStaleApprovals({
      now: new Date("2026-04-17T14:00:00Z"),
    }, { db });
    expect(count).toBe(2);
  });

  it("returns 0 when no rows expired", async () => {
    const db = mkDb();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    });
    const count = await expireStaleApprovals({
      now: new Date("2026-04-17T14:00:00Z"),
    }, { db });
    expect(count).toBe(0);
  });
});
