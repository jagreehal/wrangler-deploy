import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { resolveAccountId, resetCachedAccountId, cfApiResult } from "./cloudflare-api.js";

describe("cloudflare-api", () => {
  beforeEach(() => {
    resetCachedAccountId();
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses CLOUDFLARE_ACCOUNT_ID without fetching", async ({ task }) => {
    story.init(task);

    story.given("CLOUDFLARE_ACCOUNT_ID is set in the environment");
    process.env.CLOUDFLARE_ACCOUNT_ID = "acc-env";
    const fetchMock = vi.fn();

    story.when("resolveAccountId is called");
    story.then("it returns the env var value without making any API calls");
    await expect(resolveAccountId("token", fetchMock as unknown as typeof fetch)).resolves.toBe("acc-env");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches resolved account ids between calls", async ({ task }) => {
    story.init(task);

    story.given("no CLOUDFLARE_ACCOUNT_ID in the environment");
    story.and("the API returns an account ID");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [{ id: "acc-123" }] }),
    });

    story.when("resolveAccountId is called twice");
    await expect(resolveAccountId("token", fetchMock as unknown as typeof fetch)).resolves.toBe("acc-123");
    await expect(resolveAccountId("token", fetchMock as unknown as typeof fetch)).resolves.toBe("acc-123");

    story.then("only one API call is made");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("formats API errors from cfApiResult", async ({ task }) => {
    story.init(task);

    story.given("an API response with multiple error codes");
    const response = {
      json: async () => ({
        success: false,
        errors: [
          { code: 1001, message: "bad request" },
          { code: 1002, message: "still bad" },
        ],
      }),
    } as Response;

    story.when("cfApiResult parses the response");
    story.then("it throws with all error codes and messages formatted");
    await expect(cfApiResult(response)).rejects.toThrow(
      "Cloudflare API error: [1001] bad request, [1002] still bad"
    );
  });
});
