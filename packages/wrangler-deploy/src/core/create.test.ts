import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createViteStarter } from "./create.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wd-create-"));
  tempDirs.push(dir);
  return dir;
}

describe("createViteStarter", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scaffolds a starter project with a worker, config, and Vite frontend", () => {
    const root = makeTempDir();
    const targetDir = join(root, "my-app");

    const result = createViteStarter({
      targetDir,
      projectName: "my-app",
    });

    expect(result.template).toBe("vite");
    expect(result.files).toContain("package.json");
    expect(result.files).toContain("wrangler-deploy.config.ts");
    expect(readFileSync(join(targetDir, "package.json"), "utf-8")).toContain("\"wrangler-deploy\"");
    expect(readFileSync(join(targetDir, "wrangler-deploy.config.ts"), "utf-8")).toContain(`workers/api`);
    expect(readFileSync(join(targetDir, "workers/api/src/index.ts"), "utf-8")).toContain(`APP_STATE`);
    expect(readFileSync(join(targetDir, "src/main.ts"), "utf-8")).toContain(`Cloudflare Vite starter`);
  });

  it("refuses to scaffold into a non-empty directory without --force", () => {
    const targetDir = makeTempDir();
    writeFileSync(join(targetDir, "existing.txt"), "keep me");

    expect(() =>
      createViteStarter({
        targetDir,
      }),
    ).toThrow(/not empty/);
  });
});
