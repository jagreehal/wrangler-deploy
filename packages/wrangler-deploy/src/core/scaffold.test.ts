import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES_REPO,
  deriveSubstitutions,
  fetchTemplate,
  loadTemplateManifest,
  resolveTemplateSource,
  substitutePlaceholders,
} from "./scaffold.js";

describe("resolveTemplateSource", () => {
  const originalEnv = process.env.WD_TEMPLATES_PATH;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WD_TEMPLATES_PATH;
    else process.env.WD_TEMPLATES_PATH = originalEnv;
  });

  it("returns the github default when nothing is set", () => {
    delete process.env.WD_TEMPLATES_PATH;
    expect(resolveTemplateSource({})).toBe(DEFAULT_TEMPLATES_REPO);
  });

  it("returns the explicit source when provided", () => {
    expect(resolveTemplateSource({ source: "github:other/repo" })).toBe("github:other/repo");
  });

  it("honours WD_TEMPLATES_PATH as a file:// url", () => {
    process.env.WD_TEMPLATES_PATH = "/some/abs/path";
    expect(resolveTemplateSource({})).toBe("file:///some/abs/path");
  });

  it("resolves relative WD_TEMPLATES_PATH against cwd", () => {
    process.env.WD_TEMPLATES_PATH = "rel/templates";
    expect(resolveTemplateSource({})).toMatch(/^file:\/\/.+\/rel\/templates$/);
  });
});

describe("substitutePlaceholders", () => {
  it("replaces known tokens", () => {
    expect(substitutePlaceholders("hi {{name}}", { name: "world" })).toBe("hi world");
  });

  it("leaves unknown tokens intact", () => {
    expect(substitutePlaceholders("{{a}} {{b}}", { a: "1" })).toBe("1 {{b}}");
  });

  it("replaces multiple occurrences of the same token", () => {
    expect(substitutePlaceholders("{{x}}-{{x}}-{{x}}", { x: "z" })).toBe("z-z-z");
  });

  it("ignores tokens with whitespace or unusual chars", () => {
    expect(substitutePlaceholders("{{ name }}", { name: "x" })).toBe("{{ name }}");
    expect(substitutePlaceholders("{{na me}}", { name: "x" })).toBe("{{na me}}");
  });
});

describe("deriveSubstitutions", () => {
  it("derives name and title from a target directory", () => {
    const subs = deriveSubstitutions("/tmp/my-cool-app");
    expect(subs.projectName).toBe("my-cool-app");
    expect(subs.projectTitle).toBe("My Cool App");
  });

  it("uses an explicit project name when given", () => {
    const subs = deriveSubstitutions("/tmp/whatever", "override-name");
    expect(subs.projectName).toBe("override-name");
    expect(subs.projectTitle).toBe("Override Name");
  });

  it("populates compatibilityDate as a yyyy-mm-dd string", () => {
    const subs = deriveSubstitutions("/tmp/x");
    expect(subs.compatibilityDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("loadTemplateManifest", () => {
  it("returns the default manifest when source is not a file: url", () => {
    const manifest = loadTemplateManifest("github:any/repo");
    expect(manifest.version).toBe(1);
    expect(manifest.templates.some((t) => t.name === "vite")).toBe(true);
  });

  it("reads _index.json from a file: source when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-tpl-"));
    try {
      const fs = require("node:fs");
      fs.writeFileSync(
        join(dir, "_index.json"),
        JSON.stringify({ version: 1, templates: [{ name: "x", title: "X", description: "x" }] }),
      );
      const manifest = loadTemplateManifest(`file://${dir}`);
      expect(manifest.templates[0]?.name).toBe("x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fetchTemplate (local file source)", () => {
  let templatesDir: string;
  let targetDir: string;

  beforeEach(() => {
    templatesDir = mkdtempSync(join(tmpdir(), "wd-tpl-src-"));
    targetDir = mkdtempSync(join(tmpdir(), "wd-tpl-dst-"));
  });

  afterEach(() => {
    rmSync(templatesDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("copies a local template and substitutes placeholders", async () => {
    const fs = require("node:fs");
    fs.mkdirSync(join(templatesDir, "test-template"), { recursive: true });
    fs.writeFileSync(
      join(templatesDir, "test-template", "package.json"),
      JSON.stringify({ name: "{{projectName}}" }),
    );
    fs.writeFileSync(
      join(templatesDir, "test-template", "README.md"),
      "# {{projectTitle}}\n",
    );

    const target = join(targetDir, "my-thing");
    const result = await fetchTemplate(
      { templateName: "test-template", targetDir: target, source: `file://${templatesDir}` },
      { projectName: "my-thing", projectTitle: "My Thing", compatibilityDate: "2026-05-14" },
    );

    expect(result.files).toContain("package.json");
    expect(result.files).toContain("README.md");
    expect(JSON.parse(readFileSync(join(target, "package.json"), "utf-8")).name).toBe("my-thing");
    expect(readFileSync(join(target, "README.md"), "utf-8")).toBe("# My Thing\n");
  });
});
