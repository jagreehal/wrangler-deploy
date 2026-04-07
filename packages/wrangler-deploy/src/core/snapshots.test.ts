import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSnapshots, loadSnapshot, resolveSnapshotSources, saveSnapshot } from "./snapshots.js";
import type { CfStageConfig } from "../types.js";

const config: CfStageConfig = {
  version: 1,
  workers: ["workers/api"],
  resources: {},
  dev: {
    session: {
      persistTo: ".wrangler/state",
    },
  },
};

describe("snapshots", () => {
  it("saves and restores local state sources", () => {
    const root = mkdtempSync(join(tmpdir(), "wd-snapshots-"));
    mkdirSync(join(root, ".wrangler/state/v3/d1"), { recursive: true });
    writeFileSync(join(root, ".wrangler/state/v3/d1", "data.sqlite"), "seeded");

    const saved = saveSnapshot(config, root, "baseline");
    expect(saved.sources).toContain(".wrangler/state");
    expect(listSnapshots(root).map((snapshot) => snapshot.name)).toContain("baseline");

    writeFileSync(join(root, ".wrangler/state/v3/d1", "data.sqlite"), "mutated");
    const loaded = loadSnapshot(root, "baseline");
    expect(loaded.name).toBe("baseline");
    expect(readFileSync(join(root, ".wrangler/state/v3/d1", "data.sqlite"), "utf-8")).toBe("seeded");
  });

  it("resolves default snapshot sources from config and runtime state paths", () => {
    const root = mkdtempSync(join(tmpdir(), "wd-snapshot-sources-"));
    const sources = resolveSnapshotSources(config, root);
    expect(sources.map((source) => source.relativePath)).toContain(".wrangler/state");
    expect(sources.map((source) => source.relativePath)).toContain(".wrangler-deploy/dev-runtime.json");
  });
});
