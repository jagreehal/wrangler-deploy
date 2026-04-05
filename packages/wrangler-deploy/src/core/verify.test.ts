import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { verify } from "./verify.js";
import type { CfStageConfig, StageState } from "../types.js";
import type { StateProvider } from "./state.js";

function createMockProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

const mockConfig: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/worker"],
  deployOrder: ["apps/worker", "apps/api"],
  resources: {
    "cache-kv": { type: "kv", bindings: { "apps/api": "CACHE" } },
  },
  serviceBindings: {
    "apps/api": { BACKEND: "apps/worker" },
  },
  secrets: {
    "apps/api": ["API_KEY"],
  },
};

const mockState: StageState = {
  stage: "staging",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  resources: {
    "cache-kv": {
      type: "kv",
      desired: { name: "cache-kv-staging" },
      observed: { id: "abc123", status: "active", lastSeenAt: "2026-01-01T00:00:00Z" },
      source: "managed",
    },
  },
  workers: {
    "apps/api": { name: "api-staging" },
    "apps/worker": { name: "worker-staging" },
  },
  secrets: {
    "apps/api": { API_KEY: "set" },
  },
};

describe("verify", () => {
  it("passes when everything is correct", async ({ task }) => {
    story.init(task);

    story.given("valid state with all resources and secrets");
    const provider = createMockProvider(mockState);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification passes");
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when state is missing", async ({ task }) => {
    story.init(task);

    story.given("no state exists");
    const provider = createMockProvider(null);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification fails with state check");
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.name).toBe("State file exists");
    expect(result.checks[0]?.passed).toBe(false);
  });

  it("fails when a secret is missing", async ({ task }) => {
    story.init(task);

    story.given("state with a missing secret");
    const stateWithMissingSecret = {
      ...mockState,
      secrets: { "apps/api": { API_KEY: "missing" as const } },
    };
    const provider = createMockProvider(stateWithMissingSecret);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification fails on secret check");
    expect(result.passed).toBe(false);
    const secretCheck = result.checks.find((c) => c.name.includes("API_KEY"));
    expect(secretCheck?.passed).toBe(false);
  });

  it("fails when service binding target is missing from state", async ({ task }) => {
    story.init(task);

    story.given("state missing worker referenced in service binding");
    const stateWithMissingWorker = {
      ...mockState,
      workers: { "apps/api": { name: "api-staging" } },
    };
    const provider = createMockProvider(stateWithMissingWorker);

    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification fails on service binding check");
    expect(result.passed).toBe(false);
    const bindingCheck = result.checks.find((c) => c.name.includes("Service binding"));
    expect(bindingCheck?.passed).toBe(false);
  });

  it("fails when state still contains workers removed from the manifest", async ({ task }) => {
    story.init(task);

    story.given("state containing an extra worker not declared in config.workers");
    const stateWithOrphanedWorker: StageState = {
      ...mockState,
      workers: {
        ...mockState.workers,
        "apps/old-worker": { name: "old-worker-staging" },
      },
    };
    const provider = createMockProvider(stateWithOrphanedWorker);

    story.when("verification runs");
    const result = await verify(
      { stage: "staging" },
      { rootDir: "/repo", config: mockConfig, state: provider, existsFn: () => true },
    );

    story.then("verification should fail because state contains undeclared workers");
    expect(result.passed).toBe(false);
    const workerCheck = result.checks.find((c) => c.name.includes("Undeclared worker in state"));
    expect(workerCheck?.passed).toBe(false);
  });
});
