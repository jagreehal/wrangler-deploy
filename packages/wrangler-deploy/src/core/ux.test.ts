import { describe, expect, it } from "vitest";
import { listWorkersWithUrl, matchWorker, resolveDefaultWorker } from "./ux.js";
import type { StageState } from "../types.js";

function makeState(): StageState {
  return {
    stage: "staging",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    resources: {},
    workers: {
      "apps/api": { name: "api-staging", url: "https://api.example.workers.dev" },
      "apps/jobs": { name: "jobs-staging", url: "https://jobs.example.workers.dev" },
      "apps/internal": { name: "internal-staging" },
    },
    secrets: {},
  };
}

describe("ux helpers", () => {
  it("lists only workers that have URLs", () => {
    const entries = listWorkersWithUrl(makeState());
    expect(entries.map((entry) => entry.workerPath)).toEqual(["apps/api", "apps/jobs"]);
  });

  it("resolves default to last deployed worker when present", () => {
    const state = makeState();
    state.lastDeployedWorker = "apps/jobs";
    const entries = listWorkersWithUrl(state);
    const selected = resolveDefaultWorker(state, entries);
    expect(selected?.workerPath).toBe("apps/jobs");
  });

  it("matches by worker path or worker name", () => {
    const state = makeState();
    expect(matchWorker(state, "apps/api")?.worker.name).toBe("api-staging");
    expect(matchWorker(state, "jobs-staging")?.workerPath).toBe("apps/jobs");
  });
});
