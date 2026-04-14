import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearProjectContext,
  getProjectContextValue,
  loadProjectContext,
  loadProjectContextDetails,
  unsetProjectContext,
  writeProjectContext,
} from "./project-context.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("project-context", () => {
  it("loads the nearest .wdrc file while walking up the tree", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(
      join(root, ".wdrc"),
      JSON.stringify({
        stage: "staging",
        basePort: 9150,
        accountId: "1234567890abcdef1234567890abcdef",
      }) + "\n",
    );

    const context = loadProjectContext(join(root, "apps", "api"));

    expect(context).toEqual({
      stage: "staging",
      basePort: 9150,
      accountId: "1234567890abcdef1234567890abcdef",
    });
  });

  it("returns the project context file path when available", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, ".wdrc.json"),
      JSON.stringify({
        stage: "staging",
      }) + "\n",
    );

    const details = loadProjectContextDetails(root);

    expect(details.path).toBe(join(root, ".wdrc.json"));
    expect(details.context).toEqual({ stage: "staging" });
  });

  it("returns an empty context when no defaults file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);

    expect(loadProjectContext(root)).toEqual({});
  });

  it("writes a merged defaults file at the project root when none exists", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);

    const result = writeProjectContext(root, {
      stage: "preview",
      basePort: 9020,
      accountId: "abcdefabcdefabcdefabcdefabcdefab",
    });

    expect(result.path).toBe(join(root, ".wdrc"));
    expect(result.context).toEqual({
      stage: "preview",
      basePort: 9020,
      accountId: "abcdefabcdefabcdefabcdefabcdefab",
    });
    expect(loadProjectContext(root)).toEqual(result.context);
  });

  it("merges new values into an existing defaults file", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, ".wdrc.json"),
      JSON.stringify({
        stage: "staging",
        basePort: 8787,
      }) + "\n",
    );

    const result = writeProjectContext(root, {
      accountId: "1234567890abcdef1234567890abcdef",
    });

    expect(result.path).toBe(join(root, ".wdrc.json"));
    expect(result.context).toEqual({
      stage: "staging",
      basePort: 8787,
      accountId: "1234567890abcdef1234567890abcdef",
    });
    expect(loadProjectContext(root)).toEqual(result.context);
  });

  it("unsets selected keys without disturbing the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, ".wdrc.json"),
      JSON.stringify({
        stage: "staging",
        basePort: 8787,
        accountId: "1234567890abcdef1234567890abcdef",
      }) + "\n",
    );

    const result = unsetProjectContext(root, ["basePort", "accountId"]);

    expect(result.path).toBe(join(root, ".wdrc.json"));
    expect(result.context).toEqual({
      stage: "staging",
    });
    expect(loadProjectContext(root)).toEqual({ stage: "staging" });
  });

  it("clears the defaults file", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, ".wdrc"),
      JSON.stringify({
        stage: "staging",
      }) + "\n",
    );

    const result = clearProjectContext(root);

    expect(result.path).toBe(join(root, ".wdrc"));
    expect(result.context).toEqual({});
    expect(loadProjectContextDetails(root)).toEqual({ context: {} });
    expect(loadProjectContext(root)).toEqual({});
  });

  it("gets a single key from the resolved defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "wdrc-"));
    tempDirs.push(root);
    writeFileSync(
      join(root, ".wdrc"),
      JSON.stringify({
        stage: "staging",
        basePort: 8787,
      }) + "\n",
    );

    expect(loadProjectContext(root).stage).toBe("staging");
    expect(loadProjectContext(root).basePort).toBe(8787);
    expect(getProjectContextValue(root, "stage")).toBe("staging");
    expect(getProjectContextValue(root, "basePort")).toBe(8787);
  });
});
