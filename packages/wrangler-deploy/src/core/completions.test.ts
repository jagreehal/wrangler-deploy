import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { generateCompletions } from "./completions.js";

describe("generateCompletions", () => {
  it("zsh output contains compdef and command names", ({ task }) => {
    story.init(task);
    story.given("zsh shell requested");

    const result = generateCompletions("zsh");

    story.then("output contains compdef directive");
    expect(result).toContain("compdef");

    story.then("output contains expected command names");
    expect(result).toContain("create");
    expect(result).toContain("graph");
    expect(result).toContain("dev");
    expect(result).toContain("doctor");
    expect(result).toContain("ci");
    expect(result).toContain("completions");
  });

  it("bash output contains complete -F and command names", ({ task }) => {
    story.init(task);
    story.given("bash shell requested");

    const result = generateCompletions("bash");

    story.then("output contains complete -F directive");
    expect(result).toContain("complete -F");

    story.then("output contains expected command names");
    expect(result).toContain("create");
    expect(result).toContain("graph");
    expect(result).toContain("dev");
    expect(result).toContain("doctor");
    expect(result).toContain("COMPREPLY");
  });

  it("fish output contains complete -c wd lines and command names", ({ task }) => {
    story.init(task);
    story.given("fish shell requested");

    const result = generateCompletions("fish");

    story.then("output contains complete -c wd directive");
    expect(result).toContain("complete -c wd");

    story.then("output contains expected command names");
    expect(result).toContain("create");
    expect(result).toContain("graph");
    expect(result).toContain("dev");
    expect(result).toContain("doctor");
    expect(result).toContain("ci");
  });
});
