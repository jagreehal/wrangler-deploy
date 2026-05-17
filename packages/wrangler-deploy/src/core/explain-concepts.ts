/**
 * Concept loader for `wd explain <topic>`. Concepts are stored as markdown
 * files in `src/explain/concepts/`, copied to `dist/explain/concepts/` by
 * `scripts/copy-concepts.mjs`.
 *
 * Each concept's name is the filename without the `.md` extension. The
 * markdown body is returned verbatim so that humans see the original
 * formatting and agents get a single navigable string.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ConceptEntry {
  name: string;
  /** First-paragraph summary, derived from the markdown body. */
  summary: string;
  /** Raw markdown body. */
  body: string;
}

let cached: ConceptEntry[] | undefined;

function resolveConceptDir(): string | undefined {
  // Path candidates in order: built location, then source location for vitest.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../explain/concepts"),       // dist/core/.. → dist/explain/concepts
    resolve(here, "../../explain/concepts"),    // src/core/.. → src/explain/concepts (under src layout)
    resolve(here, "../../src/explain/concepts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function extractSummary(body: string): string {
  // Take the first non-heading, non-empty paragraph.
  const lines = body.split("\n");
  const paragraph: string[] = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (started) break;
      continue;
    }
    if (line.startsWith("#")) continue;
    started = true;
    paragraph.push(line);
  }
  return paragraph.join(" ").replace(/\s+/g, " ").trim();
}

export function loadConcepts(): ConceptEntry[] {
  if (cached) return cached;
  const dir = resolveConceptDir();
  if (!dir) {
    cached = [];
    return cached;
  }
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  cached = files.map((file) => {
    const body = readFileSync(resolve(dir, file), "utf-8");
    const name = file.replace(/\.md$/, "");
    return { name, summary: extractSummary(body), body };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}

export function getConcept(name: string): ConceptEntry | undefined {
  return loadConcepts().find((entry) => entry.name === name);
}

export function listConcepts(): Array<{ name: string; summary: string }> {
  return loadConcepts().map(({ name, summary }) => ({ name, summary }));
}

/** Cheap Levenshtein for "did you mean?" suggestions. */
export function closestConcept(input: string, names: string[]): string | undefined {
  const target = input.toLowerCase();
  let best: { name: string; distance: number } | undefined;
  for (const name of names) {
    const distance = levenshtein(target, name.toLowerCase());
    if (!best || distance < best.distance) best = { name, distance };
  }
  if (!best) return undefined;
  if (best.distance > Math.max(2, Math.floor(target.length / 2))) return undefined;
  return best.name;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let curr = i;
    for (let j = 1; j <= b.length; j += 1) {
      const insertion = (prev[j] ?? 0) + 1;
      const deletion = curr + 1;
      const substitution = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const next = Math.min(insertion, deletion, substitution);
      prev[j - 1] = curr;
      curr = next;
    }
    prev[b.length] = curr;
  }
  return prev[b.length] ?? 0;
}

/** Reset the in-memory cache. Test-only. */
export function _resetConceptCache(): void {
  cached = undefined;
}
