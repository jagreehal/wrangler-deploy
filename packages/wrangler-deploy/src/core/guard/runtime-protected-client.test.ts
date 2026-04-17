import { describe, it, expect, vi } from "vitest";
import { runListRuntimeProtected, type RuntimeProtectedDeps } from "./runtime-protected-client.js";

function mkDeps() {
  return {
    client: {
      get: vi.fn(async () => ({
        items: [
          { accountId: "a", scriptName: "api", addedAt: "t", addedBy: "cli:jag", reason: "oncall" },
        ],
      })) as unknown as RuntimeProtectedDeps["client"]["get"],
    },
  };
}

describe("runListRuntimeProtected", () => {
  it("GETs /api/runtime-protected with account in query", async () => {
    const deps = mkDeps();
    const out = await runListRuntimeProtected({ accountId: "a" }, deps);
    expect(out).toHaveLength(1);
    expect(out[0]?.scriptName).toBe("api");
    const call = (deps.client.get as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe("/api/runtime-protected?account=a");
  });
});
