import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(here, "..", "package.json");

describe("package manifest", () => {
  it("ships @cloudflare/workers-types for the public typed API", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(
      packageJson.dependencies?.["@cloudflare/workers-types"] ??
        packageJson.peerDependencies?.["@cloudflare/workers-types"],
    ).toBeTruthy();
  });

  it("ships the agent context artifact", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      files?: string[];
    };

    expect(packageJson.files).toContain("agent-context.json");
  });
});
