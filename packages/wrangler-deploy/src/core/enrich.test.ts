import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { d1, kv } from "../typed.js";
import { enrichMarkers, loadStateOutputs } from "./enrich.js";
import type { StageState } from "../types.js";

const stagingState: StageState = {
  stage: "staging",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  resources: {
    "my-db": {
      type: "d1",
      lifecycleStatus: "created",
      props: { type: "d1", name: "my-db-staging", bindings: {} },
      output: { id: "db-abc123", name: "my-db-staging", version: "v1" },
      source: "managed",
    },
    "cache": {
      type: "kv",
      lifecycleStatus: "created",
      props: { type: "kv", name: "cache-staging", bindings: {} },
      output: { id: "kv-abc123", title: "cache-staging" },
      source: "managed",
    },
  },
  workers: {},
  secrets: {},
};

describe("enrichMarkers", () => {
  it("attaches output to D1 and KV markers by resource name", ({ task }) => {
    story.init(task);

    story.given("marker objects and a StageState with matching resource entries");
    const db = d1("my-db");
    const cache = kv("cache");
    const unknown = d1("not-in-state");

    story.when("enrichMarkers is called");
    enrichMarkers([db, cache, unknown], stagingState);

    story.then("db and cache markers carry their output from state");
    expect(db.output).toEqual({ id: "db-abc123", name: "my-db-staging", version: "v1" });
    expect(cache.output).toEqual({ id: "kv-abc123", title: "cache-staging" });

    story.then("the unknown marker output remains undefined");
    expect(unknown.output).toBeUndefined();
  });

  it("is idempotent — calling twice does not corrupt output", ({ task }) => {
    story.init(task);
    story.given("a marker already enriched");
    const db = d1("my-db");
    enrichMarkers([db], stagingState);
    story.when("enriched again");
    enrichMarkers([db], stagingState);
    story.then("output is unchanged");
    expect(db.output).toEqual({ id: "db-abc123", name: "my-db-staging", version: "v1" });
  });
});

describe("loadStateOutputs", () => {
  it("returns a map of resource name → output from a StageState", ({ task }) => {
    story.init(task);

    story.given("a StageState passed directly");
    story.when("loadStateOutputs is called with the state");
    const outputs = loadStateOutputs(stagingState);

    story.then("it returns a record keyed by logical resource name");
    expect(outputs["my-db"]).toEqual({ id: "db-abc123", name: "my-db-staging", version: "v1" });
    expect(outputs["cache"]).toEqual({ id: "kv-abc123", title: "cache-staging" });
  });
});
