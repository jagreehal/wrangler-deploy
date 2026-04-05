import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { destroy } from "./destroy.js";
import type { StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";

function createMockState(overrides?: Partial<StageState>): StageState {
  return {
    stage: "staging",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    resources: {},
    workers: {
      "apps/orphaned": { name: "orphaned-staging" },
    },
    secrets: {},
    ...overrides,
  };
}

function createMockStateProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

describe("destroy", () => {
  it("deletes workers that remain in state even if they were removed from the manifest", async ({ task }) => {
    story.init(task);

    story.given("a stage state containing a deployed worker that is no longer in config.workers");
    const state = createMockState();
    const provider = createMockStateProvider(state);
    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    story.when("destroy is run against the stage");
    await destroy(
      { stage: "staging", force: true },
      {
        rootDir: "/repo",
        config: {
          version: 1,
          workers: [],
          resources: {},
        },
        state: provider,
        wrangler,
      },
    );

    story.then("the orphaned worker should still be deleted before state cleanup");
    expect(wrangler.run).toHaveBeenCalledWith(
      ["delete", "--name", "orphaned-staging", "--force"],
      "/repo",
    );
    expect(provider.delete).toHaveBeenCalledWith("staging");
    logSpy.mockRestore();
  });

  it("does not delete stage state when worker deletion fails", async ({ task }) => {
    story.init(task);

    story.given("a stage state containing a deployed worker");
    story.and("wrangler fails to delete that worker");
    const state = createMockState();
    const provider = createMockStateProvider(state);
    const wrangler: WranglerRunner = {
      run: vi.fn().mockImplementation((args: string[]) => {
        if (args[0] === "delete") {
          throw new Error("delete failed");
        }
        return "";
      }),
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    story.when("destroy is run against the stage");
    await destroy(
      { stage: "staging", force: true },
      {
        rootDir: "/repo",
        config: {
          version: 1,
          workers: [],
          resources: {},
        },
        state: provider,
        wrangler,
      },
    );

    story.then("state cleanup should not run because teardown was incomplete");
    expect(provider.delete).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not delete stage state when queue consumer removal fails", async ({ task }) => {
    story.init(task);

    story.given("a stage state containing a queue and its consumer worker");
    const state = createMockState({
      resources: {
        jobs: {
          type: "queue",
          desired: { name: "jobs-staging" },
          observed: { status: "active", lastSeenAt: "2026-04-03T00:00:00.000Z" },
          source: "managed",
        },
      },
      workers: {
        "apps/worker": { name: "worker-staging" },
      },
    });
    const provider = createMockStateProvider(state);
    const wrangler: WranglerRunner = {
      run: vi.fn().mockImplementation((args: string[]) => {
        if (args[0] === "queues" && args[1] === "consumer" && args[2] === "remove") {
          throw new Error("consumer removal failed");
        }
        return "";
      }),
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    story.when("destroy is run against the stage");
    await destroy(
      { stage: "staging", force: true },
      {
        rootDir: "/repo",
        config: {
          version: 1,
          workers: ["apps/worker"],
          resources: {
            jobs: {
              type: "queue",
              bindings: {
                "apps/worker": { consumer: true },
              },
            },
          },
        },
        state: provider,
        wrangler,
      },
    );

    story.then("state cleanup should not run because consumer teardown was incomplete");
    expect(provider.delete).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("removes queue consumers for queues that remain only in state", async ({ task }) => {
    story.init(task);

    story.given("a stage state containing a managed queue and its consumer worker");
    story.and("the queue has already been removed from config.resources");
    const state = createMockState({
      resources: {
        jobs: {
          type: "queue",
          desired: { name: "jobs-staging" },
          observed: { status: "active", lastSeenAt: "2026-04-03T00:00:00.000Z" },
          source: "managed",
        },
      },
      workers: {
        "apps/worker": { name: "worker-staging" },
      },
    });
    const provider = createMockStateProvider(state);
    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    story.when("destroy is run against the stage");
    await destroy(
      { stage: "staging", force: true },
      {
        rootDir: "/repo",
        config: {
          version: 1,
          workers: [],
          resources: {},
        },
        state: provider,
        wrangler,
      },
    );

    story.then("the queue consumer should still be detached before deletion proceeds");
    expect(wrangler.run).toHaveBeenCalledWith(
      ["queues", "consumer", "remove", "jobs-staging", "worker-staging"],
      "/repo",
    );
    logSpy.mockRestore();
  });
});
