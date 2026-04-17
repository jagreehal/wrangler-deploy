import { describe, it, expect } from "vitest";
import { loadAccountConfig, loadNotificationConfig, expandPresetsForWorker } from "./config.js";
import { stubs } from "./test-utils/stubs.js";

describe("loadAccountConfig", () => {
  it("parses a valid array", () => {
    const a = stubs.accountConfig();
    const out = loadAccountConfig(JSON.stringify([a]));
    expect(out[0]?.accountId).toBe(a.accountId);
  });

  it("throws on invalid JSON", () => {
    expect(() => loadAccountConfig("not-json")).toThrow(/ACCOUNTS_JSON/);
  });

  it("throws on missing fields", () => {
    expect(() => loadAccountConfig(JSON.stringify([{ accountId: "a" }]))).toThrow(/workers/);
  });
});

describe("loadNotificationConfig", () => {
  it("parses channels", () => {
    const cfg = stubs.notificationConfig({ channels: [stubs.discordChannelConfig(), stubs.slackChannelConfig()] });
    const out = loadNotificationConfig(JSON.stringify(cfg));
    expect(out.channels).toHaveLength(2);
  });

  it("rejects duplicate channel names", () => {
    const cfg = {
      channels: [
        { type: "discord", name: "dup", webhookUrlSecret: "A" },
        { type: "slack", name: "dup", webhookUrlSecret: "B" },
      ],
    };
    expect(() => loadNotificationConfig(JSON.stringify(cfg))).toThrow(/duplicate channel name/);
  });

  it("defaults dedupWindowSeconds", () => {
    const out = loadNotificationConfig(JSON.stringify({ channels: [] }));
    expect(out.dedupWindowSeconds).toBe(86_400);
  });
});

describe("expandPresetsForWorker", () => {
  it("cost-runaway uses rolling-avg multiplier and inherits no absolute threshold", () => {
    const w = stubs.workerConfig({ presets: ["cost-runaway"], thresholds: {} });
    const defaults = { requests: 500_000, cpuMs: 5_000_000 };
    const rolling = { avgDailyCostUsd: 10 };
    const rules = expandPresetsForWorker(w, { defaults, rolling });
    const costRule = rules.find((r) => r.ruleId === "cost-runaway");
    expect(costRule?.costUsd).toBe(20);
  });

  it("request-flood uses env default when worker threshold absent", () => {
    const w = stubs.workerConfig({ presets: ["request-flood"], thresholds: {} });
    const rules = expandPresetsForWorker(w, { defaults: { requests: 1_000, cpuMs: 1 }, rolling: { avgDailyCostUsd: 0 } });
    expect(rules.find((r) => r.ruleId === "request-flood")?.requests).toBe(1_000);
  });

  it("per-worker thresholds override preset-derived ones", () => {
    const w = stubs.workerConfig({ presets: ["request-flood"], thresholds: { requests: 42 } });
    const rules = expandPresetsForWorker(w, { defaults: { requests: 1_000, cpuMs: 1 }, rolling: { avgDailyCostUsd: 0 } });
    expect(rules.find((r) => r.ruleId === "request-flood")?.requests).toBe(42);
  });
});
