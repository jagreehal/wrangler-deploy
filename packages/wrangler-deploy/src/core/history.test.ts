import { describe, expect, it } from "vitest";
import { appendDeployEvents, appendRollbackEvent, listKnownVersions } from "./history.js";
import type { StageState } from "../types.js";

function makeState(): StageState {
  return {
    stage: "staging",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    resources: {},
    workers: {
      "apps/api": { name: "api-staging", versionId: "v-current" },
    },
    secrets: {},
  };
}

describe("history helpers", () => {
  it("appends deploy history events", () => {
    const state = makeState();
    appendDeployEvents(
      state,
      [{ workerPath: "apps/api", name: "api-staging", renderedConfigPath: "/tmp/wrangler.jsonc", urls: ["https://x"], routes: [], versionId: "v1" }],
      "2026-05-14T12:00:00.000Z",
    );
    expect(state.deploymentHistory).toEqual([
      {
        at: "2026-05-14T12:00:00.000Z",
        action: "deploy",
        workerPath: "apps/api",
        workerName: "api-staging",
        versionId: "v1",
        urls: ["https://x"],
        routes: [],
      },
    ]);
  });

  it("appends rollback history events", () => {
    const state = makeState();
    appendRollbackEvent(state, {
      workerPath: "apps/api",
      workerName: "api-staging",
      versionId: "v2",
      urls: [],
      routes: [],
    }, "2026-05-14T12:30:00.000Z");
    expect(state.deploymentHistory?.[0]).toMatchObject({
      at: "2026-05-14T12:30:00.000Z",
      action: "rollback",
      versionId: "v2",
    });
  });

  it("lists known versions from current and historical entries", () => {
    const state = makeState();
    state.deploymentHistory = [
      {
        at: "2026-05-14T12:00:00.000Z",
        action: "deploy",
        workerPath: "apps/api",
        workerName: "api-staging",
        versionId: "v1",
        urls: [],
        routes: [],
      },
    ];
    expect(listKnownVersions(state, "apps/api", "api-staging").sort()).toEqual(["v-current", "v1"].sort());
  });
});
