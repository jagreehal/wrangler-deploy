import { describe, expect, it, vi } from "vitest";
import type { CfStageConfig, StageState } from "../types.js";
import type { CheckSecretsDeps } from "./secrets.js";
import type { StateProvider } from "./state.js";
import { isSecretRef, secretName } from "../types.js";
import { checkSecrets, validateSecrets } from "./secrets.js";

describe("type guards", () => {
  it("isSecretRef detects ref objects", () => {
    expect(isSecretRef({ name: "X", ref: true })).toBe(true);
    expect(isSecretRef("X")).toBe(false);
    expect(isSecretRef({ name: "X" })).toBe(false);
    expect(isSecretRef(null)).toBe(false);
  });

  it("secretName extracts the name from either form", () => {
    expect(secretName("PLAIN")).toBe("PLAIN");
    expect(secretName({ name: "REF", ref: true })).toBe("REF");
  });
});

function makeState(overrides: Partial<StageState> = {}): StageState {
  return {
    stage: "dev",
    createdAt: "x",
    updatedAt: "x",
    resources: {},
    workers: {
      "apps/api": { name: "api-dev", deployed: true },
    },
    secrets: {},
    ...overrides,
  };
}

function makeProvider(state: StageState): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([state.stage]),
  };
}

describe("checkSecrets with SecretRef", () => {
  it("reports plain entries as set/missing and refs as ref/missing", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {},
      secrets: {
        "apps/api": ["PLAIN_OK", "PLAIN_MISSING", { name: "REF_OK", ref: true }, { name: "REF_MISSING", ref: true }],
      },
    };
    const wrangler = {
      run: vi.fn().mockReturnValue(JSON.stringify([{ name: "PLAIN_OK" }, { name: "REF_OK" }])),
    };
    const state = makeState();
    const deps: CheckSecretsDeps = {
      rootDir: "/repo",
      config,
      state: makeProvider(state),
      wrangler,
    };
    const statuses = await checkSecrets({ stage: "dev" }, deps);
    expect(statuses).toEqual([
      { worker: "apps/api", name: "PLAIN_OK", status: "set" },
      { worker: "apps/api", name: "PLAIN_MISSING", status: "missing" },
      { worker: "apps/api", name: "REF_OK", status: "ref" },
      { worker: "apps/api", name: "REF_MISSING", status: "missing" },
    ]);
  });

  it("when worker is not deployed yet, refs report ref and plain report missing", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {},
      secrets: {
        "apps/api": ["PLAIN", { name: "REF", ref: true }],
      },
    };
    const state = makeState({ workers: {} });
    const deps: CheckSecretsDeps = {
      rootDir: "/repo",
      config,
      state: makeProvider(state),
      wrangler: { run: vi.fn() },
    };
    const statuses = await checkSecrets({ stage: "dev" }, deps);
    expect(statuses[0]).toEqual({ worker: "apps/api", name: "PLAIN", status: "missing" });
    expect(statuses[1]).toEqual({ worker: "apps/api", name: "REF", status: "ref" });
  });
});

describe("validateSecrets with SecretRef", () => {
  it("treats refs as satisfied when state records them, missing when not", async () => {
    const config: CfStageConfig = {
      version: 1,
      workers: ["apps/api"],
      resources: {},
      secrets: {
        "apps/api": [
          "PLAIN_OK",
          "PLAIN_MISSING",
          { name: "REF_OK", ref: true },
          { name: "REF_NEW", ref: true },
        ],
      },
    };
    const state = makeState({
      secrets: {
        "apps/api": { PLAIN_OK: "set", REF_OK: "set" },
      },
    });
    const missing = await validateSecrets(
      { stage: "dev" },
      { rootDir: "/repo", config, state: makeProvider(state) },
    );
    expect(missing).toEqual(["apps/api/PLAIN_MISSING", "apps/api/REF_NEW (ref)"]);
  });
});
