import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { resourceName, workerName, stageMatchesPattern, isStageProtected } from "./naming.js";

describe("resourceName", () => {
  it("appends stage to logical name", ({ task }) => {
    story.init(task);
    story.given("a logical name 'cache-kv' and stage 'staging'");
    story.then("returns 'cache-kv-staging'");
    expect(resourceName("cache-kv", "staging")).toBe("cache-kv-staging");
  });

  it("works with PR stages", ({ task }) => {
    story.init(task);
    story.given("a logical name 'payment-outbox' and stage 'pr-123'");
    story.then("returns 'payment-outbox-pr-123'");
    expect(resourceName("payment-outbox", "pr-123")).toBe("payment-outbox-pr-123");
  });
});

describe("workerName", () => {
  it("appends stage to base worker name", ({ task }) => {
    story.init(task);
    story.given("a worker name 'payment-api' and stage 'staging'");
    story.then("returns 'payment-api-staging'");
    expect(workerName("payment-api", "staging")).toBe("payment-api-staging");
  });
});

describe("stageMatchesPattern", () => {
  it("matches exact names", ({ task }) => {
    story.init(task);
    story.given("stage 'staging' and pattern 'staging'");
    story.then("returns true");
    expect(stageMatchesPattern("staging", "staging")).toBe(true);
  });

  it("matches glob patterns", ({ task }) => {
    story.init(task);
    story.given("stage 'pr-123' and pattern 'pr-*'");
    story.then("returns true");
    expect(stageMatchesPattern("pr-123", "pr-*")).toBe(true);

    story.given("stage 'pr-456' and pattern 'pr-*'");
    story.then("returns true");
    expect(stageMatchesPattern("pr-456", "pr-*")).toBe(true);
  });

  it("rejects non-matching patterns", ({ task }) => {
    story.init(task);
    story.given("stage 'production' and pattern 'pr-*'");
    story.then("returns false");
    expect(stageMatchesPattern("production", "pr-*")).toBe(false);
  });
});

describe("isStageProtected", () => {
  const rules = {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false },
  };

  it("protects named stages", ({ task }) => {
    story.init(task);
    story.given("stage 'production' with protection rules");
    story.then("returns true (protected)");
    expect(isStageProtected("production", rules)).toBe(true);

    story.given("stage 'staging' with protection rules");
    story.then("returns true (protected)");
    expect(isStageProtected("staging", rules)).toBe(true);
  });

  it("allows PR stages", ({ task }) => {
    story.init(task);
    story.given("stage 'pr-123' matching 'pr-*' pattern");
    story.then("returns false (not protected)");
    expect(isStageProtected("pr-123", rules)).toBe(false);
  });

  it("defaults to protected for unknown stages", ({ task }) => {
    story.init(task);
    story.given("stage 'unknown' with no matching rule");
    story.then("returns true (protected by default)");
    expect(isStageProtected("unknown", rules)).toBe(true);
  });

  it("defaults to protected when no rules", ({ task }) => {
    story.init(task);
    story.given("stage 'anything' with undefined rules");
    story.then("returns true (protected by default)");
    expect(isStageProtected("anything", undefined)).toBe(true);
  });
});
