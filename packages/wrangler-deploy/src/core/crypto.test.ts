import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { encrypt, decrypt, encryptState, decryptState } from "./crypto.js";
import type { StageState } from "../types.js";

const PASSWORD = "test-password-123";

describe("encrypt / decrypt", () => {
  it("round-trips a plain string", async ({ task }) => {
    story.init(task);
    story.given("a plaintext string and a password");
    const plaintext = "postgresql://user:secret@host/db";

    story.when("encrypted then decrypted");
    const ciphertext = await encrypt(plaintext, PASSWORD);
    const result = await decrypt(ciphertext, PASSWORD);

    story.then("the result equals the original plaintext");
    expect(result).toBe(plaintext);
  });

  it("produces different ciphertext each call (random IV)", async ({ task }) => {
    story.init(task);
    story.given("the same plaintext encrypted twice");
    const a = await encrypt("hello", PASSWORD);
    const b = await encrypt("hello", PASSWORD);

    story.then("ciphertexts differ due to random IV");
    expect(a).not.toBe(b);
  });

  it("throws on wrong password", async ({ task }) => {
    story.init(task);
    story.given("a ciphertext encrypted with password A");
    const ciphertext = await encrypt("secret", "password-a");

    story.when("decrypted with password B");
    story.then("it throws");
    await expect(decrypt(ciphertext, "password-b")).rejects.toThrow();
  });
});

describe("encryptState / decryptState", () => {
  it("encrypts hyperdrive origin and storedSecrets, leaves other fields plain", async ({ task }) => {
    story.init(task);

    story.given("a StageState with a Hyperdrive resource and storedSecrets");
    const state: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "pg": {
          type: "hyperdrive",
          lifecycleStatus: "created",
          props: { type: "hyperdrive", name: "pg-staging", bindings: {} },
          output: { id: "hd-123", name: "pg-staging", origin: "postgresql://user:pass@host/db" },
          source: "managed",
        },
        "cache": {
          type: "kv",
          lifecycleStatus: "created",
          props: { type: "kv", name: "cache-staging", bindings: {} },
          output: { id: "kv-123", title: "cache-staging" },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
      storedSecrets: { "apps/api": { STRIPE_KEY: "sk_live_123" } },
    };

    story.when("encryptState is called with a password");
    const encrypted = await encryptState(state, PASSWORD);

    story.then("hyperdrive origin is no longer plaintext");
    const hyperdriveOutput = encrypted.resources["pg"]!.output as { origin: string };
    expect(hyperdriveOutput.origin).not.toBe("postgresql://user:pass@host/db");
    expect(hyperdriveOutput.origin).toMatch(/^v1:/);

    story.then("storedSecrets values are encrypted");
    expect(encrypted.storedSecrets?.["apps/api"]?.STRIPE_KEY).not.toBe("sk_live_123");

    story.then("kv output is unchanged (no sensitive fields)");
    const kvOutput = encrypted.resources["cache"]!.output as { id: string };
    expect(kvOutput.id).toBe("kv-123");
  });

  it("decryptState reverses encryptState", async ({ task }) => {
    story.init(task);

    story.given("an encrypted state");
    const original: StageState = {
      stage: "staging",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: {
        "pg": {
          type: "hyperdrive",
          lifecycleStatus: "created",
          props: { type: "hyperdrive", name: "pg-staging", bindings: {} },
          output: { id: "hd-123", name: "pg-staging", origin: "postgresql://user:pass@host/db" },
          source: "managed",
        },
      },
      workers: {},
      secrets: {},
      storedSecrets: { "apps/api": { STRIPE_KEY: "sk_live_123" } },
    };
    const encrypted = await encryptState(original, PASSWORD);

    story.when("decryptState is called with the same password");
    const decrypted = await decryptState(encrypted, PASSWORD);

    story.then("all values are restored to their original plaintext");
    const hyperdriveOutput = decrypted.resources["pg"]!.output as { origin: string };
    expect(hyperdriveOutput.origin).toBe("postgresql://user:pass@host/db");
    expect(decrypted.storedSecrets?.["apps/api"]?.STRIPE_KEY).toBe("sk_live_123");
  });
});
