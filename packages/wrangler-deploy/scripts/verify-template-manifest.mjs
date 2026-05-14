#!/usr/bin/env node
// Drift check for the generated template manifest. Verifies that running the
// generator against the current `templates/_index.json` produces exactly the
// content currently on disk. Independent of git state — works for fresh
// checkouts, staged-but-uncommitted files, and CI checkouts.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const generatedPath = resolve(packageRoot, "src/core/template-manifest.generated.ts");
const generatorPath = resolve(here, "generate-template-manifest.mjs");

let beforeContent = "";
try {
  beforeContent = readFileSync(generatedPath, "utf-8");
} catch {
  beforeContent = "";
}

// Run the generator, capture what it would emit, then restore the original
// content so verification is non-mutating. (Mutating the working tree from a
// CI check confuses subsequent steps and editors.)
execFileSync("node", [generatorPath], { stdio: "pipe" });
const afterContent = readFileSync(generatedPath, "utf-8");
writeFileSync(generatedPath, beforeContent);

if (beforeContent === afterContent) {
  process.exit(0);
}

console.error("");
console.error("✗ Generated template manifest is out of sync with templates/_index.json");
console.error("");
console.error("  Regenerating from _index.json would change src/core/template-manifest.generated.ts.");
console.error("");
console.error("  Fix:");
console.error("    pnpm --filter wrangler-deploy generate:template-manifest");
console.error("    git add packages/wrangler-deploy/src/core/template-manifest.generated.ts");
console.error("");
process.exit(1);
