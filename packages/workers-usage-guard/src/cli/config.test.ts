import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  saveConfig,
  resolveEndpoint,
  resolveAccount,
  buildAccountsJson,
  buildNotificationsJson,
  listNotificationSecrets,
} from "./config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "wug-test-"));
}

describe("loadConfig", () => {
  it("returns {} when file missing", () => {
    const dir = tempDir();
    try {
      expect(loadConfig({ cwd: dir })).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads JSON from disk", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "wug.config.json"), JSON.stringify({ endpoint: "https://x" }));
      expect(loadConfig({ cwd: dir })).toEqual({ endpoint: "https://x" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-object root", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "wug.config.json"), JSON.stringify(["not", "an", "object"]));
      expect(() => loadConfig({ cwd: dir })).toThrow(/expected an object/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("saveConfig", () => {
  it("round-trips", () => {
    const dir = tempDir();
    try {
      saveConfig({ cwd: dir, config: { endpoint: "https://y" } });
      expect(loadConfig({ cwd: dir })).toEqual({ endpoint: "https://y" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveEndpoint precedence", () => {
  it("flag > env > config", () => {
    expect(
      resolveEndpoint({
        config: { endpoint: "https://from-config" },
        flags: { endpoint: "https://from-flag", "signing-key": "k" },
        env: { WUG_ENDPOINT: "https://from-env" },
      }),
    ).toEqual({ endpoint: "https://from-flag", signingKey: "k" });
  });

  it("env wins over config when no flag", () => {
    expect(
      resolveEndpoint({
        config: { endpoint: "https://from-config" },
        flags: { "signing-key": "k" },
        env: { WUG_ENDPOINT: "https://from-env" },
      }),
    ).toEqual({ endpoint: "https://from-env", signingKey: "k" });
  });

  it("config used when no flag/env", () => {
    expect(
      resolveEndpoint({
        config: { endpoint: "https://from-config" },
        flags: {},
        env: { GUARD_API_SIGNING_KEY: "k" },
      }),
    ).toEqual({ endpoint: "https://from-config", signingKey: "k" });
  });

  it("throws when endpoint missing", () => {
    expect(() => resolveEndpoint({ config: {}, flags: {}, env: { GUARD_API_SIGNING_KEY: "k" } })).toThrow(/endpoint/);
  });

  it("throws when signing key missing", () => {
    expect(() => resolveEndpoint({ config: { endpoint: "https://x" }, flags: {}, env: {} })).toThrow(/signing key/);
  });
});

describe("resolveAccount precedence", () => {
  it("flag wins", () => {
    expect(
      resolveAccount({
        config: { accounts: [{ accountId: "from-config", billingCycleDay: 1, workers: [] }] },
        flags: { account: "from-flag" },
        env: { WUG_ACCOUNT: "from-env" },
      }),
    ).toBe("from-flag");
  });
  it("falls back to first config account", () => {
    expect(
      resolveAccount({
        config: { accounts: [{ accountId: "abc", billingCycleDay: 1, workers: [] }] },
        flags: {},
        env: {},
      }),
    ).toBe("abc");
  });
  it("throws when nothing set", () => {
    expect(() => resolveAccount({ config: {}, flags: {}, env: {} })).toThrow(/account/);
  });
});

describe("buildAccountsJson + buildNotificationsJson + listNotificationSecrets", () => {
  it("renders ACCOUNTS_JSON shape with default globalProtected", () => {
    const json = buildAccountsJson({
      accounts: [{ accountId: "a", billingCycleDay: 1, workers: [{ scriptName: "api" }] }],
    });
    expect(JSON.parse(json)).toEqual([
      { accountId: "a", billingCycleDay: 1, workers: [{ scriptName: "api" }], globalProtected: [] },
    ]);
  });

  it("renders empty notifications when not configured", () => {
    expect(JSON.parse(buildNotificationsJson({}))).toEqual({ channels: [] });
  });

  it("lists secrets from each channel type", () => {
    expect(
      listNotificationSecrets({
        notifications: {
          channels: [
            { type: "discord", webhookUrlSecret: "DISCORD_HOOK" },
            { type: "webhook", urlSecret: "OPS_HOOK" },
          ],
        },
      }),
    ).toEqual(["DISCORD_HOOK", "OPS_HOOK"]);
  });
});
