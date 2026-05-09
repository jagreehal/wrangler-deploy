import { describe, expect, it } from "vitest";
import type { CfStageConfig, StageState } from "../types.js";
import {
  buildStateList,
  buildStateTree,
  getStateEntry,
  renderStateGetText,
  renderStateListText,
  renderTreeAscii,
} from "./state-commands.js";

function makeState(): StageState {
  return {
    stage: "staging",
    createdAt: "2026-05-06T00:00:00Z",
    updatedAt: "2026-05-06T01:00:00Z",
    resources: {
      cache: {
        type: "kv",
        lifecycleStatus: "created",
        lifecycle: { adoptRequested: true, adoptSupported: true },
        source: "managed",
        props: { type: "kv", name: "cache-kv-staging", bindings: { "apps/api": "CACHE" } },
        output: { id: "kv_abc123", title: "cache-kv-staging" },
      },
      "my-db": {
        type: "d1",
        lifecycleStatus: "updated",
        source: "managed",
        props: { type: "d1", name: "my-db-staging", bindings: { "apps/api": "DB" } },
        output: { id: "d1_def456", name: "my-db-staging", version: "v1" },
      },
    },
    workers: {
      "apps/api": { name: "api-staging", deployed: true, url: "https://api.example.com" },
      "apps/worker": { name: "worker-staging", deployed: false },
    },
    secrets: {},
  };
}

function makeConfig(): CfStageConfig {
  return {
    version: 1,
    workers: ["apps/api", "apps/worker"],
    resources: {
      cache: { type: "kv", bindings: { "apps/api": "CACHE" } },
      "my-db": { type: "d1", bindings: { "apps/api": "DB" } },
    },
    serviceBindings: {
      "apps/api": { BACKEND: "apps/worker" },
    },
  } as unknown as CfStageConfig;
}

describe("buildStateList", () => {
  it("returns one row per resource sorted by name", () => {
    const rows = buildStateList(makeState());
    expect(rows.map((r) => r.resource)).toEqual(["cache", "my-db"]);
    expect(rows[0]).toMatchObject({ type: "kv", id: "kv_abc123", status: "created" });
    expect(rows[1]).toMatchObject({ type: "d1", id: "d1_def456", status: "updated" });
  });

  it("renders a human-readable table with headers", () => {
    const text = renderStateListText(makeState());
    expect(text).toContain("NAME");
    expect(text).toContain("cache");
    expect(text).toContain("kv_abc123");
  });

  it("emits an empty-state message when no resources", () => {
    const empty: StageState = { ...makeState(), resources: {} };
    expect(renderStateListText(empty)).toMatch(/no resources in state/);
  });
});

describe("getStateEntry", () => {
  it("returns props, output, and id for an existing resource", () => {
    const entry = getStateEntry(makeState(), "cache");
    expect(entry).toMatchObject({
      resource: "cache",
      type: "kv",
      id: "kv_abc123",
      stagedName: "cache-kv-staging",
    });
    expect(entry?.output).toEqual({ id: "kv_abc123", title: "cache-kv-staging" });
    expect(entry?.lifecycle).toEqual({ adoptRequested: true, adoptSupported: true });
  });

  it("returns undefined for a missing resource", () => {
    expect(getStateEntry(makeState(), "ghost")).toBeUndefined();
  });

  it("renders a multi-section human view", () => {
    const text = renderStateGetText(getStateEntry(makeState(), "cache")!);
    expect(text).toContain("cache  (kv)");
    expect(text).toContain("status:");
    expect(text).toContain("output:");
    expect(text).toContain("props:");
    expect(text).toContain("lifecycle:");
  });
});

describe("buildStateTree", () => {
  it("places workers under the root and bindings under workers", () => {
    const tree = buildStateTree(makeState(), makeConfig());
    expect(tree.label).toBe("stage: staging");
    const apiNode = tree.children.find((c) => c.label === "apps/api")!;
    expect(apiNode).toBeTruthy();
    expect(apiNode.children.map((c) => c.label).sort()).toEqual(["BACKEND", "CACHE", "DB"]);
    const cacheBinding = apiNode.children.find((c) => c.label === "CACHE");
    expect(cacheBinding?.detail).toContain("[adopt:true, supported]");
  });

  it("includes a worker even when it has no deploy state yet", () => {
    const state = makeState();
    delete state.workers["apps/worker"];
    const tree = buildStateTree(state, makeConfig());
    expect(tree.children.some((c) => c.label === "apps/worker")).toBe(true);
  });

  it("renders ASCII with branch glyphs", () => {
    const tree = buildStateTree(makeState(), makeConfig());
    const ascii = renderTreeAscii(tree);
    expect(ascii).toContain("stage: staging");
    expect(ascii).toMatch(/├──|└──/);
  });

  it("lists unbound managed resources at the root", () => {
    const state = makeState();
    state.resources["orphan"] = {
      type: "r2",
      lifecycleStatus: "created",
      source: "managed",
      props: { type: "r2", name: "orphan-r2-staging", bindings: {} },
      output: { name: "orphan-r2-staging" },
    };
    const tree = buildStateTree(state, makeConfig());
    expect(tree.children.some((c) => c.label === "orphan")).toBe(true);
  });
});
