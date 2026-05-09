import { describe, expect, it, vi } from "vitest";
import workerModule from "./index.js";
import type { Env } from "./env.js";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    OVERAGE_WORKFLOW: { create: vi.fn() } as unknown as Workflow,
    ACCOUNTS_JSON: JSON.stringify([
      { accountId: "acct-a", billingCycleDay: 1, workers: [], globalProtected: [] },
      { accountId: "acct-b", billingCycleDay: 1, workers: [], globalProtected: [] },
    ]),
    NOTIFICATIONS_JSON: JSON.stringify({ channels: [] }),
    REQUEST_THRESHOLD: "500000",
    CPU_TIME_THRESHOLD_MS: "300000",
    OVERAGE_COOLDOWN_SECONDS: "300",
    OVERAGE_GRACE_SECONDS: "300",
    GUARD_SCRIPT_NAME: "workers-usage-guard",
    CLOUDFLARE_API_TOKEN: "token",
    GUARD_API_SIGNING_KEY: "key",
    ...overrides,
  };
}

describe("worker entrypoint", () => {
  it("fails fast on invalid numeric thresholds", async () => {
    const env = makeEnv({ REQUEST_THRESHOLD: "NaN" });
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const controller = { cron: "*/5 * * * *" } as ScheduledController;
    await expect(workerModule.scheduled(controller, env, ctx)).rejects.toThrow(/REQUEST_THRESHOLD/);
  });

  it("health endpoint aggregates latest check/report across accounts", async () => {
    const db = {
      prepare: vi.fn().mockImplementation((sql: string) => ({
        bind: vi.fn().mockImplementation((accountId: string) => ({
          all: vi.fn().mockResolvedValue({
            results: sql.includes("FROM usage_reports")
              ? accountId === "acct-a"
                ? [{
                  id: "r-a",
                  account_id: "acct-a",
                  billing_period_start: "2026-05-01T00:00:00.000Z",
                  billing_period_end: "2026-05-31T23:59:59.000Z",
                  generated_at: "2026-05-01T00:00:00.000Z",
                  payload_json: "{}",
                }]
                : [{
                  id: "r-b",
                  account_id: "acct-b",
                  billing_period_start: "2026-05-01T00:00:00.000Z",
                  billing_period_end: "2026-05-31T23:59:59.000Z",
                  generated_at: "2026-05-03T00:00:00.000Z",
                  payload_json: "{}",
                }]
              : accountId === "acct-a"
                ? [{
                  id: "f-a",
                  breach_key: "acct-a:api:requests",
                  workflow_instance_id: "wf-a",
                  triggered_at: "2026-05-02T00:00:00.000Z",
                  rule_id: "r1",
                  graphql_response_json: "{}",
                  actions_taken_json: null,
                  estimated_savings_usd: null,
                }]
                : [{
                  id: "f-b",
                  breach_key: "acct-b:api:requests",
                  workflow_instance_id: "wf-b",
                  triggered_at: "2026-05-04T00:00:00.000Z",
                  rule_id: "r1",
                  graphql_response_json: "{}",
                  actions_taken_json: null,
                  estimated_savings_usd: null,
                }],
          }),
        })),
      })),
    } as unknown as D1Database;
    const env = makeEnv({ DB: db });

    const res = await workerModule.fetch(
      new Request("https://guard.example.com/api/health"),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lastCheck: string | null; lastReport: string | null };
    expect(body.lastCheck).toBe("2026-05-04T00:00:00.000Z");
    expect(body.lastReport).toBe("2026-05-03T00:00:00.000Z");
  });
});
