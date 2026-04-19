import { describe, it, expect } from "vitest";
import { defineConfig } from "./config.js";

describe("defineConfig with guard field", () => {
  it("preserves guard.accounts and guard.endpoint", () => {
    const cfg = defineConfig({
      version: 1,
      workers: [],
      resources: {},
      guard: {
        endpoint: "https://guard.example.workers.dev",
        accounts: [
          {
            accountId: "a",
            billingCycleDay: 1,
            workers: [{ scriptName: "api" }],
            globalProtected: [],
          },
        ],
      },
    });
    expect(cfg.guard?.endpoint).toBe("https://guard.example.workers.dev");
    expect(cfg.guard?.accounts?.[0]?.accountId).toBe("a");
  });

  it("is optional — omitting guard still produces a valid config", () => {
    const cfg = defineConfig({ version: 1, workers: [], resources: {} });
    expect(cfg.guard).toBeUndefined();
  });
});
