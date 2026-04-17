import { describe, it, expect, vi } from "vitest";
import { runDisarm, runArm } from "./disarm.js";
import type { DisarmDeps, ArmDeps } from "./disarm.js";

describe("runDisarm", () => {
  it("POSTs /api/disarm with account + script + optional reason", async () => {
    const client = {
      post: vi.fn(async () => ({ ok: true })),
    };
    const out = await runDisarm(
      { accountId: "a", scriptName: "api", reason: "oncall", addedBy: "cli:jag" },
      { client } as unknown as DisarmDeps
    );
    expect(out.ok).toBe(true);
    expect(client.post).toHaveBeenCalledWith(
      "/api/disarm",
      { accountId: "a", scriptName: "api", addedBy: "cli:jag", reason: "oncall" },
      expect.any(Object)
    );
  });

  it("omits reason when not provided", async () => {
    const client = {
      post: vi.fn(async () => ({ ok: true })),
    };
    await runDisarm({ accountId: "a", scriptName: "api", addedBy: "cli:jag" }, { client } as unknown as DisarmDeps);
    const call = (client.post as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[1]).toEqual({ accountId: "a", scriptName: "api", addedBy: "cli:jag" });
  });
});

describe("runArm", () => {
  it("DELETEs /api/disarm with account + script", async () => {
    const client = {
      delete: vi.fn(async () => ({ ok: true })),
    };
    const out = await runArm({ accountId: "a", scriptName: "api" }, { client } as unknown as ArmDeps);
    expect(out.ok).toBe(true);
    expect(client.delete).toHaveBeenCalledWith(
      "/api/disarm",
      { accountId: "a", scriptName: "api" },
      expect.any(Object)
    );
  });
});
