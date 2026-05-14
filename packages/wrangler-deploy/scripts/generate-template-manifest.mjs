#!/usr/bin/env node
// Read templates/_index.json (the canonical source of available scaffold
// templates) and emit a typed TypeScript constant that ships inside the
// published CLI bundle. The generated file is the picker's fallback when no
// local templates directory is available (i.e. real users on npm).
//
// Running this script is automatic via the `prebuild` hook. Adding a new
// template means: drop a directory in `templates/`, add an entry to
// `_index.json`, run `pnpm build`. No need to touch any TS file.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");
const indexPath = resolve(repoRoot, "templates/_index.json");
const outPath = resolve(packageRoot, "src/core/template-manifest.generated.ts");

const raw = JSON.parse(readFileSync(indexPath, "utf-8"));

if (raw.version !== 1) {
  console.error(`Unexpected templates/_index.json version: ${raw.version}`);
  process.exit(1);
}
if (!Array.isArray(raw.templates)) {
  console.error("templates/_index.json must contain a `templates` array.");
  process.exit(1);
}

const banner = `// AUTO-GENERATED — do not edit by hand.
// Source: templates/_index.json
// Run \`pnpm --filter wrangler-deploy generate:template-manifest\` (or just
// \`pnpm --filter wrangler-deploy build\`) to regenerate.`;

const body = `${banner}

import type { TemplateManifest } from "./scaffold.js";

export const BUILT_IN_TEMPLATE_MANIFEST: TemplateManifest = ${JSON.stringify(
  { version: raw.version, templates: raw.templates },
  null,
  2,
)} as const;
`;

writeFileSync(outPath, body);
console.log(`Wrote ${outPath}`);
