import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { slackAdapter } from "./slack.js";
import type { NotifyDeps } from "../types.js";
import { stubs } from "../../test-utils/stubs.js";

function deps(): NotifyDeps {
  const d = mock<NotifyDeps>();
  d.ssrf.validate = vi.fn().mockReturnValue({ ok: true }) as typeof d.ssrf.validate;
  d.clock = vi.fn().mockReturnValue(new Date("2026-04-17T12:00:00Z")) as unknown as typeof d.clock;
  d.secrets = vi.fn().mockReturnValue("https://hooks.slack.com/services/X/Y/Z") as unknown as typeof d.secrets;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d.fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 })) as any;
  d.log = vi.fn().mockResolvedValue(undefined) as unknown as typeof d.log;
  return d;
}

describe("slackAdapter", () => {
  it("posts blocks payload and returns ok", async () => {
    const d = deps();
    const channel = slackAdapter({ name: "eng", webhookUrlSecret: "S" });
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d" }, d);
    expect(r.ok).toBe(true);
    const [, init] = (d.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(Array.isArray(body.blocks)).toBe(true);
  });

  it("BAD_CONFIG when secret missing", async () => {
    const d = deps();
    d.secrets = vi.fn().mockReturnValue(undefined) as unknown as typeof d.secrets;
    const channel = slackAdapter({ name: "eng", webhookUrlSecret: "S" });
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d" }, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_CONFIG");
  });
});
