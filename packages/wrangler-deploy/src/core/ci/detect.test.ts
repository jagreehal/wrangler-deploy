import { describe, it, expect } from "vitest";
import { detectCiEnvironment } from "./detect.js";

describe("detectCiEnvironment", () => {
  it("detects GitHub Actions environment", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "ghp_test123",
      GITHUB_REPOSITORY: "myorg/myrepo",
      GITHUB_REF: "refs/pull/42/merge",
      GITHUB_SHA: "abc123def456",
    };

    const result = detectCiEnvironment(env);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("github");
    expect(result?.repo).toBe("myorg/myrepo");
    expect(result?.token).toBe("ghp_test123");
    expect(result?.prNumber).toBe(42);
    expect(result?.sha).toBe("abc123def456");
  });

  it("returns null when not in CI", () => {
    const result = detectCiEnvironment({});
    expect(result).toBeNull();
  });

  it("extracts PR number from pull_request event", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "ghp_test",
      GITHUB_REPOSITORY: "org/repo",
      GITHUB_REF: "refs/pull/123/merge",
    };

    const result = detectCiEnvironment(env);

    expect(result?.prNumber).toBe(123);
  });

  it("has no prNumber for push events", () => {
    const env = {
      GITHUB_ACTIONS: "true",
      GITHUB_TOKEN: "ghp_test",
      GITHUB_REPOSITORY: "org/repo",
      GITHUB_REF: "refs/heads/main",
    };

    const result = detectCiEnvironment(env);

    expect(result).not.toBeNull();
    expect(result?.prNumber).toBeUndefined();
  });
});
