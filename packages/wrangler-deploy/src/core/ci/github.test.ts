import { describe, it, expect, vi } from "vitest";
import { createGitHubProvider } from "./github.js";
import type { CiContext } from "./types.js";

const context: CiContext = {
  provider: "github",
  repo: "myorg/myrepo",
  token: "ghp_test123",
  sha: "abc123",
};

describe("createGitHubProvider", () => {
  it("creates a new comment when none exists", async () => {
    const fetchMock = vi.fn();

    // List comments returns empty array
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    // Create comment
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const provider = createGitHubProvider(context, fetchMock);
    await provider.updateComment(42, "Hello world", "<!-- marker -->");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [listUrl] = fetchMock.mock.calls[0]!;
    expect(listUrl).toContain("/repos/myorg/myrepo/issues/42/comments");

    const [createUrl, createOpts] = fetchMock.mock.calls[1]!;
    expect(createUrl).toContain("/repos/myorg/myrepo/issues/42/comments");
    expect(createOpts.method).toBe("POST");
    const body = JSON.parse(createOpts.body);
    expect(body.body).toContain("<!-- marker -->");
    expect(body.body).toContain("Hello world");
  });

  it("updates existing comment when marker found", async () => {
    const fetchMock = vi.fn();

    // List comments returns one with marker
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 99, body: "<!-- marker --> old content" }],
    });
    // PATCH update
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 99 }),
    });

    const provider = createGitHubProvider(context, fetchMock);
    await provider.updateComment(42, "New content", "<!-- marker -->");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [patchUrl, patchOpts] = fetchMock.mock.calls[1]!;
    expect(patchUrl).toContain("/repos/myorg/myrepo/issues/comments/99");
    expect(patchOpts.method).toBe("PATCH");
    const body = JSON.parse(patchOpts.body);
    expect(body.body).toContain("<!-- marker -->");
    expect(body.body).toContain("New content");
  });

  it("creates check run with status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const provider = createGitHubProvider(context, fetchMock);
    await provider.createCheckRun("deploy-check", "success", "All checks passed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/repos/myorg/myrepo/check-runs");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.name).toBe("deploy-check");
    expect(body.conclusion).toBe("success");
    expect(body.head_sha).toBe("abc123");
  });
});
