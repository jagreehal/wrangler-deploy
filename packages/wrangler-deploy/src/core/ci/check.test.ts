import { describe, it, expect, vi } from "vitest";
import { story } from "executable-stories-vitest";
import { postCheckRun } from "./check.js";
import type { CiProvider } from "./types.js";
import type { StageState } from "../../types.js";

function mockProvider(): CiProvider {
  return {
    postComment: vi.fn(),
    updateComment: vi.fn(),
    createCheckRun: vi.fn(),
  };
}

const fakeState: StageState = {
  stage: "pr-42",
  createdAt: "2026-04-06T00:00:00Z",
  updatedAt: "2026-04-06T00:00:00Z",
  workers: {},
  resources: {},
  secrets: {},
};

describe("postCheckRun", () => {
  it("posts a success check run when state exists", async ({ task }) => {
    story.init(task);
    story.given("a valid stage state and a GitHub provider");

    const provider = mockProvider();
    const result = await postCheckRun(provider, "pr-42", fakeState);

    story.then("a success check run is created via the provider");
    expect(provider.createCheckRun).toHaveBeenCalledWith(
      "wrangler-deploy/verify",
      "success",
      expect.stringContaining("pr-42"),
    );
    expect(result.status).toBe("success");
    expect(result.posted).toBe(true);
  });

  it("posts a failure check run when state is null", async ({ task }) => {
    story.init(task);
    story.given("a null state (stage has not been deployed)");

    const provider = mockProvider();
    const result = await postCheckRun(provider, "pr-42", null);

    story.then("a failure check run is created via the provider");
    expect(provider.createCheckRun).toHaveBeenCalledWith(
      "wrangler-deploy/verify",
      "failure",
      expect.stringContaining("No state found"),
    );
    expect(result.status).toBe("failure");
    expect(result.posted).toBe(true);
  });
});
