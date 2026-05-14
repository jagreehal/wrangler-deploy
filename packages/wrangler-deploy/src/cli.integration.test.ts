import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const distCli = resolve(packageRoot, "dist/cli/index.js");
const tempDirs: string[] = [];

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wd-cli-int-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(repoDir: string): void {
  writeFileSync(
    join(repoDir, "wrangler-deploy.config.js"),
    `export default {
  version: 1,
  workers: ["apps/api"],
  resources: {},
  stages: { staging: { protected: false } }
};
`,
  );
}

function writeState(repoDir: string): void {
  mkdirSync(join(repoDir, ".wrangler-deploy", "staging"), { recursive: true });
  writeFileSync(
    join(repoDir, ".wrangler-deploy", "staging", "state.json"),
    JSON.stringify(
      {
        stage: "staging",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        resources: {},
        workers: {
          "apps/api": {
            name: "api-staging",
            versionId: "v-current",
            url: "https://api-staging.example.workers.dev",
            urls: ["https://api-staging.example.workers.dev"],
            routes: ["api.example.com/*"],
            deployed: true,
          },
        },
        deploymentHistory: [
          {
            at: "2026-05-13T12:00:00.000Z",
            action: "deploy",
            workerPath: "apps/api",
            workerName: "api-staging",
            versionId: "v-1",
            urls: ["https://api-staging.example.workers.dev"],
            routes: ["api.example.com/*"],
          },
          {
            at: "2026-05-14T08:00:00.000Z",
            action: "rollback",
            workerPath: "apps/api",
            workerName: "api-staging",
            versionId: "v-2",
            urls: ["https://api-staging.example.workers.dev"],
            routes: ["api.example.com/*"],
          },
        ],
        secrets: {},
      },
      null,
      2,
    ) + "\n",
  );
}

function runCli(repoDir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [distCli, ...args], {
    cwd: repoDir,
    env: { ...process.env },
    encoding: "utf-8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

beforeAll(() => {
  execFileSync("pnpm", ["-C", packageRoot, "build"], { stdio: "pipe" });
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI integration (dist)", () => {
  it("returns deployment history in JSON mode", () => {
    const repo = makeRepo();
    writeConfig(repo);
    writeState(repo);

    const result = runCli(repo, ["history", "--stage", "staging", "--json"]);
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as { count: number; history: Array<{ action: string }> };
    expect(payload.count).toBe(2);
    expect(payload.history.map((h) => h.action)).toEqual(["deploy", "rollback"]);
  });

  it("lists rollback versions for a worker", () => {
    const repo = makeRepo();
    writeConfig(repo);
    writeState(repo);

    const result = runCli(repo, ["rollback", "list", "--stage", "staging", "--worker", "apps/api", "--json"]);
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as { versions: string[] };
    expect(payload.versions.sort()).toEqual(["v-1", "v-2", "v-current"].sort());
  });

  it("validates macro commands with quoted args", () => {
    const repo = makeRepo();
    writeConfig(repo);
    writeState(repo);
    mkdirSync(join(repo, ".wrangler-deploy"), { recursive: true });
    writeFileSync(
      join(repo, ".wrangler-deploy", "macros.json"),
      JSON.stringify(
        {
          smoke: [
            "wd history --stage staging --json",
            "wd explain --json \"WD_E_STATE_MISSING\"",
          ],
        },
        null,
        2,
      ) + "\n",
    );

    const result = runCli(repo, ["macro", "validate", "--json"]);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as { valid: boolean; errors: unknown[] };
    expect(payload.valid).toBe(true);
    expect(payload.errors).toHaveLength(0);
  });
});
