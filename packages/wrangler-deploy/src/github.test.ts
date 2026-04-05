import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";

const rootDir = resolve(import.meta.dirname, "..");
const cliSource = readFileSync(resolve(rootDir, "src/cli/index.ts"), "utf-8");
const actionSource = readFileSync(resolve(rootDir, "github/action.yml"), "utf-8");
const workflowSource = readFileSync(resolve(rootDir, "github/example-workflow.yml"), "utf-8");

describe("GitHub automation", () => {
  it("does not call CLI flags that the current CLI does not expose", ({ task }) => {
    story.init(task);

    story.given("the GitHub Action source and the CLI source");

    story.when("the action uses --json with the status command");
    const actionUsesStatusJson =
      actionSource.includes("wrangler-deploy status --stage") && actionSource.includes("--json");

    story.then("the CLI must also expose the --json flag");
    if (actionUsesStatusJson) {
      expect(cliSource).toContain("--json");
    }
  });

  it("only references example workflow commands that exist in the CLI help", ({ task }) => {
    story.init(task);

    story.given("the example workflow and the CLI source");

    story.when("the workflow references the gc command");
    story.then("the CLI must define the gc command");
    if (workflowSource.includes("npx wrangler-deploy gc")) {
      expect(cliSource).toContain("gc");
    }
  });

  it("declares a schedule trigger when a scheduled cleanup job exists", ({ task }) => {
    story.init(task);

    story.given("the example workflow source");

    story.when("the workflow has a schedule-conditional cleanup job");
    const hasCleanupJob = workflowSource.includes("if: github.event_name == 'schedule'");

    story.then("the workflow must declare a schedule trigger");
    if (hasCleanupJob) {
      expect(workflowSource).toMatch(/schedule:/);
    }
  });
});
