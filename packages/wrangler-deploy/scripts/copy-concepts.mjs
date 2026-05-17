#!/usr/bin/env node
// Copies src/explain/concepts/*.md into dist/explain/concepts/ so the
// shipped CLI can read them at runtime (tsc does not copy non-TS files).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "src/explain/concepts");
const dst = resolve(root, "dist/explain/concepts");

if (!existsSync(src)) {
  console.warn(`[copy-concepts] no source dir at ${src} — skipping`);
  process.exit(0);
}

mkdirSync(dst, { recursive: true });

const files = readdirSync(src).filter((name) => name.endsWith(".md"));
for (const name of files) {
  copyFileSync(resolve(src, name), resolve(dst, name));
}

console.log(`[copy-concepts] copied ${files.length} markdown concept file(s) to ${dst}`);
