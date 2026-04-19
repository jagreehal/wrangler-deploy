import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { computeDedupKey, dispatch } from "./dispatcher.js";
import type { NotifyDeps, NotificationChannel } from "./types.js";
import type { NotificationEvent, NotificationResult } from "usage-guard-shared";
import { stubs } from "../test-utils/stubs.js";

function makeChannel(name: string, result: NotificationResult): NotificationChannel {
  return {
    name,
    kind: "webhook",
    send: vi.fn().mockResolvedValue(result),
  };
}

function mkDeps(): NotifyDeps & { db: D1Database; dedupWindowSeconds: number } {
  const base = mock<NotifyDeps>();
  base.clock = vi.fn().mockReturnValue(new Date("2026-04-17T12:00:00Z")) as unknown as typeof base.clock;
  base.log = vi.fn().mockResolvedValue(undefined) as unknown as typeof base.log;
  const db = mock<D1Database>();
  const stmt = mock<D1PreparedStatement>();
  db.prepare.mockReturnValue(stmt);
  stmt.bind.mockReturnValue(stmt);
  stmt.first.mockResolvedValue(null as unknown as never);
  stmt.run.mockResolvedValue({ success: true } as unknown as never);
  return Object.assign(base, { db, dedupWindowSeconds: 3600 });
}

describe("computeDedupKey", () => {
  it("breach uses accountId:scriptName:breachType:YYYY-MM-DD", () => {
    const breach = stubs.breachForensic({ breachKey: "a:api:requests" });
    const e: NotificationEvent = { kind: "breach", severity: "critical", breach, actions: stubs.killSwitchActions() };
    expect(computeDedupKey(e, new Date("2026-04-17T12:00:00Z"))).toBe("a:api:requests:2026-04-17");
  });

  it("daily-report uses daily-report:YYYY-MM-DD", () => {
    const e: NotificationEvent = { kind: "daily-report", severity: "info", report: stubs.usageReport() };
    expect(computeDedupKey(e, new Date("2026-04-17T12:00:00Z"))).toBe("daily-report:2026-04-17");
  });

  it("approval-requested uses stable approval id key", () => {
    const e: NotificationEvent = {
      kind: "approval-requested",
      severity: "warning",
      approvalId: "appr-123",
      accountId: "a",
      scriptName: "api",
      ruleId: "request-flood",
      breachType: "requests",
      actualValue: 600_000,
      limitValue: 500_000,
    };
    expect(computeDedupKey(e, new Date("2026-04-17T12:00:00Z"))).toBe("approval-requested:appr-123");
  });
});

describe("dispatch", () => {
  it("fans out to every channel", async () => {
    const d = mkDeps();
    const channels = [
      makeChannel("a", { ok: true, channel: "a", sentAt: "t", dedupKey: "k" }),
      makeChannel("b", { ok: true, channel: "b", sentAt: "t", dedupKey: "k" }),
    ];
    const results = await dispatch({ event: stubs.breachEvent(), channels }, d);
    expect(results).toHaveLength(2);
    expect(channels[0]!.send).toHaveBeenCalled();
    expect(channels[1]!.send).toHaveBeenCalled();
  });

  it("one failing channel does not block others", async () => {
    const d = mkDeps();
    const channels = [
      makeChannel("bad", { ok: false, channel: "bad", error: { code: "NON_2XX", message: "500" } }),
      makeChannel("good", { ok: true, channel: "good", sentAt: "t", dedupKey: "k" }),
    ];
    const results = await dispatch({ event: stubs.breachEvent(), channels }, d);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("skips channels already in dedupe window", async () => {
    const d = mkDeps();
    const firstPrep = mock<D1PreparedStatement>();
    firstPrep.bind.mockReturnValue(firstPrep);
    firstPrep.first.mockResolvedValue({ sent_at: "t" } as unknown as never);
    (d.db.prepare as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce(firstPrep);
    const channels = [makeChannel("a", { ok: true, channel: "a", sentAt: "t", dedupKey: "k" })];
    const results = await dispatch({ event: stubs.breachEvent(), channels }, d);
    // Since deduped, channel.send should NOT have been called, and a synthesized ok Result is returned.
    expect(channels[0]!.send).not.toHaveBeenCalled();
    expect(results[0]?.ok).toBe(true);
  });
});
