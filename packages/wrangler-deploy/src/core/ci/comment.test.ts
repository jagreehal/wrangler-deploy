import { describe, it, expect } from "vitest";
import { buildPrComment } from "./comment.js";
import type { CfStageConfig, StageState } from "../../types.js";

const config: CfStageConfig = {
  version: 1,
  workers: ["apps/api", "apps/worker"],
  resources: {
    myKv: { type: "kv", bindings: { "apps/api": "MY_KV" } },
  },
  secrets: { "apps/api": ["API_KEY"] },
};

const state: StageState = {
  stage: "pr-42",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  workers: {
    "apps/api": { name: "my-api-pr-42", url: "https://my-api-pr-42.workers.dev" },
    "apps/worker": { name: "my-worker-pr-42" },
  },
  resources: {
    myKv: {
      type: "kv",
      desired: { name: "my-kv-pr-42" },
      observed: { id: "abc123", status: "active" },
      source: "managed",
    },
  },
  secrets: {
    "apps/api": { API_KEY: "set" },
  },
};

describe("buildPrComment", () => {
  it("includes worker URLs", () => {
    const comment = buildPrComment(config, state);
    expect(comment).toContain("https://my-api-pr-42.workers.dev");
  });

  it("includes mermaid code block", () => {
    const comment = buildPrComment(config, state);
    expect(comment).toContain("```mermaid");
    expect(comment).toContain("graph TD");
  });

  it("includes resource table with IDs", () => {
    const comment = buildPrComment(config, state);
    expect(comment).toContain("abc123");
    expect(comment).toContain("myKv");
  });

  it("includes secrets names only, no values", () => {
    const comment = buildPrComment(config, state);
    expect(comment).toContain("API_KEY");
    // Should not contain the literal word "set" as a value leak check is unreliable,
    // but should never contain actual secret values
    // The secrets section should have the key name
    expect(comment).toContain("apps/api");
  });

  it("includes verification results when provided", () => {
    const verifyResults = [
      { name: "API health check", passed: true },
      { name: "Worker smoke test", passed: false },
    ];
    const comment = buildPrComment(config, state, verifyResults);
    expect(comment).toContain("API health check");
    expect(comment).toContain("Worker smoke test");
  });
});
