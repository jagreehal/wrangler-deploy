import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { discordAdapter } from "./discord.js";
import type { NotifyDeps } from "../types.js";
import { stubs } from "../../test-utils/stubs.js";

function makeDeps(overrides: Partial<NotifyDeps> = {}): NotifyDeps {
  const d = mock<NotifyDeps>();
  d.ssrf.validate = vi.fn().mockReturnValue({ ok: true }) as typeof d.ssrf.validate;
  d.clock = vi.fn().mockReturnValue(new Date("2026-04-17T12:00:00Z")) as unknown as typeof d.clock;
  d.secrets = vi.fn().mockReturnValue("https://discord.com/api/webhooks/abc/def") as unknown as typeof d.secrets;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as any;
  d.log = vi.fn().mockResolvedValue(undefined) as unknown as typeof d.log;
  return Object.assign(d, overrides);
}

describe("discordAdapter", () => {
  it("posts an embed with severity color and returns ok", async () => {
    // Arrange
    const deps = makeDeps();
    const channel = discordAdapter({ name: "prod", webhookUrlSecret: "X" });

    // Act
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d-1" }, deps);

    // Assert
    expect(r.ok).toBe(true);
    const call = (deps.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.embeds[0].color).toBeTypeOf("number");
    expect(Array.isArray(body.embeds[0].fields)).toBe(true);
  });

  it("returns SSRF error when validator rejects", async () => {
    const deps = makeDeps();
    (deps.ssrf.validate as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({ ok: false, reason: "private" });
    const channel = discordAdapter({ name: "prod", webhookUrlSecret: "X" });
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d-1" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SSRF");
  });

  it("returns BAD_CONFIG when secret is missing", async () => {
    const deps = makeDeps();
    deps.secrets = vi.fn().mockReturnValue(undefined);
    const channel = discordAdapter({ name: "prod", webhookUrlSecret: "X" });
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d-1" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_CONFIG");
  });

  it("returns NON_2XX on 4xx", async () => {
    const deps = makeDeps();
    deps.fetch = vi.fn().mockResolvedValue(new Response("bad", { status: 400 })) as NotifyDeps["fetch"];
    const channel = discordAdapter({ name: "prod", webhookUrlSecret: "X" });
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d-1" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NON_2XX");
  });

  it("skips channel when event severity below minSeverity and returns ok with noop dedup", async () => {
    const deps = makeDeps();
    const channel = discordAdapter({ name: "prod", webhookUrlSecret: "X", minSeverity: "critical" });
    const r = await channel.send({ event: stubs.dailyReportEvent(), dedupKey: "d-1" }, deps);
    expect(r.ok).toBe(true);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
