import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { updateJsonc } from "./jsonc-writer.js";

describe("updateJsonc", () => {
  it("adds a new key while preserving comments", ({ task }) => {
    story.init(task);
    story.given("a JSONC string with a comment header");
    const input = `// Worker config\n{\n  "name": "my-worker"\n}`;

    story.when("a new key is added via updates");
    const result = updateJsonc(input, { newKey: "newValue" });

    story.then("the result contains the new key");
    const parsed = JSON.parse(result.replace(/\/\/.*$/gm, ""));
    expect(parsed.newKey).toBe("newValue");
    expect(parsed.name).toBe("my-worker");

    story.then("the comment is preserved in the output");
    expect(result).toContain("// Worker config");
  });

  it("updates an existing key value", ({ task }) => {
    story.init(task);
    story.given("a JSONC string with an existing key");
    const input = `{\n  "name": "old-name",\n  "version": 1\n}`;

    story.when("the key is updated");
    const result = updateJsonc(input, { name: "new-name" });

    story.then("the key is updated and others are preserved");
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe("new-name");
    expect(parsed.version).toBe(1);
  });

  it("adds nested objects for env sections", ({ task }) => {
    story.init(task);
    story.given("a JSONC string with a top-level config");
    const input = `{\n  "name": "worker"\n}`;

    story.when("a nested env section is added");
    const result = updateJsonc(input, { env: { staging: { kv_namespaces: [{ binding: "KV", id: "abc" }] } } });

    story.then("the nested structure is present in the output");
    const parsed = JSON.parse(result);
    expect(parsed.env?.staging?.kv_namespaces?.[0]?.id).toBe("abc");
  });

  it("handles trailing commas", ({ task }) => {
    story.init(task);
    story.given("a JSONC string with trailing commas");
    const input = `{\n  "name": "worker",\n  "version": 1,\n}`;

    story.when("parsed and updated");
    const result = updateJsonc(input, { extra: true });

    story.then("trailing commas are removed and extra key is added");
    const parsed = JSON.parse(result);
    expect(parsed.extra).toBe(true);
    expect(parsed.name).toBe("worker");
  });
});
