import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CfStageConfig } from "../types.js";
import { renderDevUi } from "./dev-ui.js";

function makeConfig(overrides?: Partial<CfStageConfig>): CfStageConfig {
  return {
    version: 1,
    workers: [],
    resources: {},
    ...overrides,
  };
}

describe("renderDevUi", () => {
  it("shows project defaults and agent metadata", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "wrangler-deploy-dev-ui-"));
    try {
      writeFileSync(
        join(rootDir, ".wdrc"),
        JSON.stringify(
          {
            stage: "staging",
            fallbackStage: "preview",
            basePort: 8787,
            session: true,
            statePassword: "secret",
          },
          null,
          2,
        ),
      );
      mkdirSync(join(rootDir, ".wrangler-deploy"), { recursive: true });
      writeFileSync(
        join(rootDir, ".wrangler-deploy", "dev-runtime.json"),
        JSON.stringify(
          {
            mode: "workers",
            ports: {},
            workers: [],
            logFiles: {},
            updatedAt: "2026-04-14T00:00:00.000Z",
            pid: 1234,
          },
          null,
          2,
        ),
      );

      const html = await renderDevUi(makeConfig(), rootDir, { autoRefresh: false });

      expect(html).toContain("Project Context");
      expect(html).toContain("Agent Metadata");
      expect(html).toContain("staging");
      expect(html).toContain("preview");
      expect(html).toContain("8787");
      expect(html).toContain("[set]");
      expect(html).toContain("wd schema --json");
      expect(html).toContain("wd tools --json");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
