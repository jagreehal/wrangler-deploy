import { describe, it, expect, vi } from "vitest";
import { disableWorkersDevSubdomain } from "./workers-dev.js";

describe("disableWorkersDevSubdomain", () => {
  it("sends PUT with enabled:false to the subdomain endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: {} }), { status: 200 }));
    await disableWorkersDevSubdomain(
      { accountId: "acct", scriptName: "my-worker" },
      { fetch: fetch as unknown as typeof fetch, token: "tok" }
    );
    const call = fetch.mock.calls[0]!;
    expect(call[0]).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/services/my-worker/subdomain");
    const opts = call[1] as RequestInit;
    expect(opts.method).toBe("PUT");
    expect(opts.body).toBe(JSON.stringify({ enabled: false }));
  });
});
