import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listVibeTargets, parseVibeTargets, writeVibeRules } from "./vibe-rules.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wd-vibe-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseVibeTargets", () => {
  it("expands 'all' to every supported target", () => {
    const targets = parseVibeTargets("all");
    expect(targets.length).toBe(listVibeTargets().length);
  });

  it("parses comma-separated lists", () => {
    expect(parseVibeTargets("claude-code,cursor")).toEqual(["claude-code", "cursor"]);
  });

  it("throws on unknown targets", () => {
    expect(() => parseVibeTargets("emacs")).toThrow(/Unknown vibe target/);
  });

  it("returns empty array for blank input", () => {
    expect(parseVibeTargets("")).toEqual([]);
  });
});

describe("writeVibeRules", () => {
  it("writes one file per target with the wrangler-deploy header", () => {
    const result = writeVibeRules({ targetDir: tmpDir, targets: ["claude-code", "cursor"] });
    expect(result.files).toEqual([".claude/wrangler-deploy.md", ".cursor/rules/wrangler-deploy.md"]);
    expect(existsSync(resolve(tmpDir, ".claude/wrangler-deploy.md"))).toBe(true);
    const content = readFileSync(resolve(tmpDir, ".cursor/rules/wrangler-deploy.md"), "utf-8");
    expect(content).toContain("wrangler-deploy");
    expect(content).toContain("wd plan");
  });

  it("skips existing files unless force is set", () => {
    const path = resolve(tmpDir, ".claude/wrangler-deploy.md");
    writeVibeRules({ targetDir: tmpDir, targets: ["claude-code"] });
    writeFileSync(path, "EXISTING");

    const result = writeVibeRules({ targetDir: tmpDir, targets: ["claude-code"] });
    expect(result.skipped).toEqual([".claude/wrangler-deploy.md"]);
    expect(readFileSync(path, "utf-8")).toBe("EXISTING");
  });

  it("overwrites when force is true", () => {
    const path = resolve(tmpDir, ".claude/wrangler-deploy.md");
    writeVibeRules({ targetDir: tmpDir, targets: ["claude-code"] });
    writeFileSync(path, "OLD");
    writeVibeRules({ targetDir: tmpDir, targets: ["claude-code"], force: true });
    expect(readFileSync(path, "utf-8")).toContain("wrangler-deploy");
  });

  it("supports AGENTS.md as a target", () => {
    const result = writeVibeRules({ targetDir: tmpDir, targets: ["agents-md"] });
    expect(result.files).toEqual(["AGENTS.md"]);
    expect(existsSync(resolve(tmpDir, "AGENTS.md"))).toBe(true);
  });
});
