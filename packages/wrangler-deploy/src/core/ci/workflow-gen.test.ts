import { describe, it, expect } from "vitest";
import { generateGitHubWorkflow } from "./workflow-gen.js";

describe("generateGitHubWorkflow", () => {
  it("has pull_request and push triggers", () => {
    const workflow = generateGitHubWorkflow({ mainBranch: "main" });
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("main");
  });

  it("includes apply, deploy, verify, comment steps", () => {
    const workflow = generateGitHubWorkflow({ mainBranch: "main" });
    expect(workflow).toContain("wd apply");
    expect(workflow).toContain("wd deploy");
    expect(workflow).toContain("--verify");
  });

  it("includes destroy job for closed PRs", () => {
    const workflow = generateGitHubWorkflow({ mainBranch: "main" });
    expect(workflow).toContain("wd destroy");
    expect(workflow).toContain("closed");
  });

  it("references CLOUDFLARE_API_TOKEN", () => {
    const workflow = generateGitHubWorkflow({ mainBranch: "main" });
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("declares the GitHub token permissions needed for comments and check runs", () => {
    const workflow = generateGitHubWorkflow({ mainBranch: "main" });
    expect(workflow).toContain("permissions:");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("checks: write");
  });
});
