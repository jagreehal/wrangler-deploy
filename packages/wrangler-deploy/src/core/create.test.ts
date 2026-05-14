import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createHelloStarter } from "./create.js";
import { fetchTemplate } from "./scaffold.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wd-create-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createHelloStarter", () => {
  it("scaffolds the inline hello-world worker (no network, no resources)", () => {
    const root = makeTempDir();
    const targetDir = join(root, "my-hello");

    const result = createHelloStarter({
      targetDir,
      projectName: "my-hello",
    });

    expect(result.template).toBe("hello");
    expect(result.files).toContain("package.json");
    expect(result.files).toContain("wrangler.jsonc");
    expect(result.files).toContain("src/index.ts");
    expect(readFileSync(join(targetDir, "src/index.ts"), "utf-8")).toContain("Hello from Cloudflare Workers");
    // No resources/bindings in the bare template — beginners shouldn't hit
    // a placeholder KV id before they understand bindings.
    expect(readFileSync(join(targetDir, "wrangler-deploy.config.ts"), "utf-8")).toContain("resources: {}");
  });

  it("refuses to scaffold into a non-empty directory without --force", () => {
    const targetDir = makeTempDir();
    writeFileSync(join(targetDir, "existing.txt"), "keep me");

    expect(() => createHelloStarter({ targetDir })).toThrow(/not empty/);
  });
});

describe("fetchTemplate (vite from repo templates dir)", () => {
  it("scaffolds the vite template from the local templates directory", async () => {
    const root = makeTempDir();
    const targetDir = join(root, "my-app");
    // Use the repo's `templates/` dir as the local source so this test runs
    // hermetically (no network). The same code path serves production
    // `github:…` sources.
    const repoTemplates = resolve(__dirname, "../../../../templates");

    const result = await fetchTemplate(
      {
        templateName: "vite",
        targetDir,
        source: `file://${repoTemplates}`,
      },
      {
        projectName: "my-app",
        projectTitle: "My App",
        compatibilityDate: "2026-05-14",
      },
    );

    expect(result.files).toContain("package.json");
    expect(result.files).toContain("wrangler-deploy.config.ts");
    expect(result.files).toContain("workers/api/src/index.ts");
    expect(result.files).toContain("workers/api/wrangler.jsonc");

    // Placeholders substituted: package name + compatibility date.
    expect(JSON.parse(readFileSync(join(targetDir, "package.json"), "utf-8")).name).toBe("my-app");
    expect(readFileSync(join(targetDir, "workers/api/wrangler.jsonc"), "utf-8")).toContain('"compatibility_date": "2026-05-14"');
    expect(readFileSync(join(targetDir, "README.md"), "utf-8")).toContain("# My App");
  });
});
