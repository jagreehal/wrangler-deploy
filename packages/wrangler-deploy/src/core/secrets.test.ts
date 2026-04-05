import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import type { CfStageConfig, StageState } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { checkSecrets, setSecret, syncSecretsFromEnvFile, validateSecrets } from "./secrets.js";

const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api"],
  deployOrder: ["apps/api"],
  resources: {},
  secrets: {
    "apps/api": ["AUTH_SECRET", "API_KEY"],
  },
};

function createMockProvider(state: StageState | null): StateProvider {
  return {
    read: vi.fn().mockResolvedValue(state),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(state ? [state.stage] : []),
  };
}

describe("secrets", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty when all secrets are set", async ({ task }) => {
    story.init(task);

    story.given("state with all secrets set");
    const provider = createMockProvider({
      stage: "staging",
      createdAt: "",
      updatedAt: "",
      resources: {},
      workers: { "apps/api": { name: "api-staging" } },
      secrets: { "apps/api": { AUTH_SECRET: "set", API_KEY: "set" } },
    });

    const missing = await validateSecrets(
      { stage: "staging" },
      { rootDir: "/repo", config, state: provider },
    );

    story.then("validation returns empty array");
    expect(missing).toEqual([]);
  });

  it("returns missing secrets", async ({ task }) => {
    story.init(task);

    story.given("state with some secrets missing");
    const provider = createMockProvider({
      stage: "staging",
      createdAt: "",
      updatedAt: "",
      resources: {},
      workers: { "apps/api": { name: "api-staging" } },
      secrets: { "apps/api": { AUTH_SECRET: "set", API_KEY: "missing" } },
    });

    const missing = await validateSecrets(
      { stage: "staging" },
      { rootDir: "/repo", config, state: provider },
    );

    story.then("validation returns list of missing secrets");
    expect(missing).toEqual(["apps/api/API_KEY"]);
  });

  it("returns all missing when no secrets in state", async ({ task }) => {
    story.init(task);

    story.given("state with no secrets recorded");
    const provider = createMockProvider({
      stage: "staging",
      createdAt: "",
      updatedAt: "",
      resources: {},
      workers: {},
      secrets: {},
    });

    const missing = await validateSecrets(
      { stage: "staging" },
      { rootDir: "/repo", config, state: provider },
    );

    story.then("validation returns all declared secrets as missing");
    expect(missing).toEqual(["apps/api/AUTH_SECRET", "apps/api/API_KEY"]);
  });

  it("checks secrets via wrangler and persists the result to state", async ({ task }) => {
    story.init(task);

    story.given("state with workers");
    const provider = createMockProvider({
      stage: "staging",
      createdAt: "",
      updatedAt: "",
      resources: {},
      workers: { "apps/api": { name: "api-staging" } },
      secrets: {},
    });

    story.and("wrangler returns one secret");
    const wrangler: WranglerRunner = {
      run: vi.fn().mockReturnValue(
        JSON.stringify([{ name: "AUTH_SECRET", type: "secret_text" }]),
      ),
    };

    const result = await checkSecrets(
      { stage: "staging" },
      { rootDir: "/repo", config, state: provider, wrangler },
    );

    story.then("returns correct status for each secret");
    expect(result).toEqual([
      { worker: "apps/api", name: "AUTH_SECRET", status: "set" },
      { worker: "apps/api", name: "API_KEY", status: "missing" },
    ]);

    story.and("state is updated with secret status");
    expect(provider.write).toHaveBeenCalledWith(
      "staging",
      expect.objectContaining({
        secrets: {
          "apps/api": {
            AUTH_SECRET: "set",
            API_KEY: "missing",
          },
        },
      }),
    );
  });

  it("sets a secret through wrangler secret put", ({ task }) => {
    story.init(task);

    story.given("worker name, secret name and value");
    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };

    story.when("setSecret is called");
    setSecret(
      { workerName: "api-staging", secretName: "AUTH_SECRET", value: "super-secret" },
      { rootDir: "/repo", wrangler },
    );

    story.then("wrangler secret put is executed");
    expect(wrangler.run).toHaveBeenCalledWith(
      ["secret", "put", "AUTH_SECRET", "--name", "api-staging"],
      "/repo",
    );
  });

  it("syncs declared secrets from an env file and updates state", async ({ task }) => {
    story.init(task);

    const tempDir = mkdtempSync(join(tmpdir(), "cf-stage-secrets-"));
    tempDirs.push(tempDir);
    const envFile = join(tempDir, ".dev.vars");

    story.given("an env file with AUTH_SECRET");
    writeFileSync(envFile, "AUTH_SECRET=alpha\n# comment\nUNUSED=value\n");

    story.and("state with workers");
    const provider = createMockProvider({
      stage: "staging",
      createdAt: "",
      updatedAt: "",
      resources: {},
      workers: { "apps/api": { name: "api-staging" } },
      secrets: {},
    });

    const mockSetSecret = vi.fn();
    const wrangler: WranglerRunner = { run: vi.fn().mockReturnValue("") };

    const result = await syncSecretsFromEnvFile(
      { stage: "staging", envFilePath: envFile },
      { rootDir: "/repo", config, state: provider, wrangler, setSecretFn: mockSetSecret },
    );

    story.then("secrets matching env file are set");
    expect(result).toEqual({
      set: ["apps/api/AUTH_SECRET"],
      skipped: ["apps/api/API_KEY (not in env file)"],
    });

    story.and("state is updated with secret status");
    expect(provider.write).toHaveBeenCalledWith(
      "staging",
      expect.objectContaining({
        secrets: {
          "apps/api": {
            AUTH_SECRET: "set",
          },
        },
      }),
    );
  });
});
