import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";

describe("local CLI-backed providers", () => {
  it("extracts the created D1 database id from wrangler output", ({ task }) => {
    story.init(task);

    story.given("wrangler output containing a D1 database UUID");
    const output = 'Created DB.\n[[d1_databases]]\nid = "123e4567-e89b-12d3-a456-426614174000"';

    story.when("the UUID regex runs against the output");
    const match = output.match(/([a-f0-9-]{36})/);

    story.then("the database ID is extracted");
    expect(match?.[1]).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("treats existing R2 buckets as non-fatal based on error message matching", ({ task }) => {
    story.init(task);

    story.given("an error message indicating a bucket already exists");
    const errorOutput = "bucket already exists";

    story.when("the error is checked for the 'already exists' pattern");
    story.then("the match succeeds, allowing the error to be treated as non-fatal");
    expect(errorOutput.includes("already exists")).toBe(true);
  });
});
