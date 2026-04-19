import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { webhookAdapter } from "./webhook.js";
import type { NotifyDeps } from "../types.js";
import { stubs } from "../../test-utils/stubs.js";

function deps(): NotifyDeps {
  const d = mock<NotifyDeps>();
  d.ssrf.validate = vi.fn().mockReturnValue({ ok: true }) as typeof d.ssrf.validate;
  d.clock = vi.fn().mockReturnValue(new Date("2026-04-17T12:00:00Z")) as unknown as typeof d.clock;
  d.secrets = vi.fn().mockReturnValue("https://ops.example.com/hook") as unknown as typeof d.secrets;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 })) as any;
  d.log = vi.fn().mockResolvedValue(undefined) as unknown as typeof d.log;
  return d;
}

describe("webhookAdapter", () => {
  it("POSTs raw NotificationEvent JSON and passes through headers", async () => {
    const d = deps();
    const channel = webhookAdapter({
      name: "ops",
      urlSecret: "O",
      headers: { "x-k": "v" },
    });
    const r = await channel.send({ event: stubs.breachEvent(), dedupKey: "d" }, d);
    expect(r.ok).toBe(true);
    const [, init] = (d.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((init as { headers: Record<string, string> }).headers["x-k"]).toBe("v");
  });
});
