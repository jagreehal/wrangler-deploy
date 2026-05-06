import { describe, expect, it, vi } from "vitest";
import type { StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import { encryptState } from "./crypto.js";
import { eraseSecrets, rotatePassword } from "./rotate-password.js";

function emptyState(stage: string): StageState {
  return {
    stage,
    createdAt: "x",
    updatedAt: "x",
    resources: {},
    workers: {},
    secrets: {},
  };
}

function makeProvider(states: Record<string, StageState>): StateProvider {
  const store = { ...states };
  return {
    list: vi.fn(async () => Object.keys(store)),
    read: vi.fn(async (stage: string) => store[stage] ?? null),
    write: vi.fn(async (stage: string, state: StageState) => {
      store[stage] = state;
    }),
    delete: vi.fn(async (stage: string) => {
      delete store[stage];
    }),
  };
}

describe("rotatePassword", () => {
  it("rotates each stage's encrypted secrets to a new password", async () => {
    const stage = emptyState("dev");
    stage.storedSecrets = { "apps/api": { TOKEN: "supersecret" } };
    const encrypted = await encryptState(stage, "old-pw");
    const provider = makeProvider({ dev: encrypted });

    const result = await rotatePassword({
      provider,
      oldPassword: "old-pw",
      newPassword: "new-pw",
    });

    expect(result.rotated).toEqual(["dev"]);
    expect(result.skipped).toEqual([]);

    const finalRaw = (provider.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as StageState;
    const token = finalRaw.storedSecrets?.["apps/api"]?.TOKEN ?? "";
    expect(token.startsWith("v1:")).toBe(true);
  });

  it("skips stages that fail to decrypt with the old password", async () => {
    const goodState = await encryptState(
      { ...emptyState("dev"), storedSecrets: { "apps/api": { TOKEN: "x" } } },
      "old-pw",
    );
    const badState = await encryptState(
      { ...emptyState("staging"), storedSecrets: { "apps/api": { TOKEN: "y" } } },
      "different-pw",
    );
    const provider = makeProvider({ dev: goodState, staging: badState });

    const result = await rotatePassword({
      provider,
      oldPassword: "old-pw",
      newPassword: "new-pw",
    });

    expect(result.rotated).toEqual(["dev"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.stage).toBe("staging");
    expect(result.skipped[0]?.reason).toMatch(/decrypt/);
  });

  it("rotates only the stages passed in via args.stages", async () => {
    const provider = makeProvider({
      dev: await encryptState(emptyState("dev"), "old-pw"),
      prod: await encryptState(emptyState("prod"), "old-pw"),
    });

    await rotatePassword({
      provider,
      oldPassword: "old-pw",
      newPassword: "new-pw",
      stages: ["dev"],
    });

    expect(provider.list).not.toHaveBeenCalled();
    expect(provider.write).toHaveBeenCalledTimes(1);
  });
});

describe("eraseSecrets", () => {
  it("clears encrypted hyperdrive origins and stored secret maps", () => {
    const state: StageState = {
      ...emptyState("dev"),
      resources: {
        pg: {
          type: "hyperdrive",
          lifecycleStatus: "created",
          source: "managed",
          props: { type: "hyperdrive", name: "pg-dev", bindings: {} },
          output: { id: "h1", name: "pg-dev", origin: "v1:abc:def" } as never,
        },
      },
      storedSecrets: {
        "apps/api": { TOKEN: "v1:enc:cipher" },
      },
    };

    const erased = eraseSecrets(state);
    expect((erased.resources.pg?.output as { origin: string }).origin).toBe("");
    expect(erased.storedSecrets).toEqual({});
  });

  it("leaves unencrypted fields alone", () => {
    const state: StageState = {
      ...emptyState("dev"),
      resources: {
        pg: {
          type: "hyperdrive",
          lifecycleStatus: "created",
          source: "managed",
          props: { type: "hyperdrive", name: "pg-dev", bindings: {} },
          output: { id: "h1", name: "pg-dev", origin: "postgresql://plain" } as never,
        },
      },
    };
    const erased = eraseSecrets(state);
    expect((erased.resources.pg?.output as { origin: string }).origin).toBe("postgresql://plain");
  });
});
