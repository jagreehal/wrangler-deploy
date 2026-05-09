import { describe, it, expect, vi } from "vitest";
import { gql, fetchWorkerUsage } from "./graphql.js";
import type { GqlFetch } from "./graphql.js";

function mockFetch(body: unknown, status = 200): GqlFetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
}

describe("gql", () => {
  it("returns data on success", async () => {
    const fetch = mockFetch({ data: { hi: 1 } });
    const out = await gql<{ hi: number }>(
      { query: "q", variables: {} },
      { fetch, token: "T" }
    );
    expect(out.hi).toBe(1);
  });

  it("throws on GraphQL errors", async () => {
    const fetch = mockFetch({ errors: [{ message: "bad" }] });
    await expect(
      gql({ query: "q", variables: {} }, { fetch, token: "T" })
    ).rejects.toThrow(/bad/);
  });
});

describe("fetchWorkerUsage", () => {
  it("maps dimensions + sum into WorkerUsage rows and converts cpu μs to ms", async () => {
    const fetch = mockFetch({
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: [
                { dimensions: { scriptName: "api" }, sum: { requests: 10, cpuTime: 2_000_000 } },
              ],
            },
          ],
        },
      },
    });
    const out = await fetchWorkerUsage(
      { accountId: "a", periodStart: "s", periodEnd: "e", scriptNames: ["api"] },
      { fetch, token: "T" }
    );
    expect(out.rows[0]).toEqual({ scriptName: "api", requests: 10, cpuMs: 2000 });
  });
});
