import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { downloadTemplate } from "giget";
import { BUILT_IN_TEMPLATE_MANIFEST } from "./template-manifest.generated.js";

export interface TemplateManifestEntry {
  name: string;
  title: string;
  description: string;
  tags?: string[];
}

export interface TemplateManifest {
  version: 1;
  templates: TemplateManifestEntry[];
}

export interface FetchTemplateOptions {
  templateName: string;
  targetDir: string;
  /**
   * Override the templates source. Useful for development (point at a local
   * checkout of this repo) and tests. Accepts:
   *   - an absolute local path (resolved as `file://<path>/<templateName>`)
   *   - a giget source string (e.g. `github:jagreehal/wrangler-deploy/templates`)
   * Defaults to the GitHub templates directory.
   */
  source?: string;
  force?: boolean;
}

export interface FetchTemplateResult {
  templateName: string;
  source: string;
  targetDir: string;
  /** Relative paths of all written files (after placeholder substitution). */
  files: string[];
}

export const DEFAULT_TEMPLATES_REPO = "github:jagreehal/wrangler-deploy/templates";

/**
 * Resolve the templates root to use. Honours, in order:
 *   1. `options.source` passed explicitly
 *   2. `WD_TEMPLATES_PATH` env var (local-dev override)
 *   3. The default GitHub source
 */
export function resolveTemplateSource(options: { source?: string }): string {
  if (options.source) return options.source;
  const envOverride = process.env.WD_TEMPLATES_PATH;
  if (envOverride) {
    const abs = isAbsolute(envOverride) ? envOverride : resolve(process.cwd(), envOverride);
    return `file://${abs}`;
  }
  return DEFAULT_TEMPLATES_REPO;
}

/**
 * Substitute placeholder tokens in template file contents.
 *
 * Convention: templates use `{{token}}` markers. The CLI passes a small set of
 * substitutions at scaffold time (project name, compatibility date, etc.).
 * Unknown tokens are left intact so template authors can use literal `{{x}}`
 * elsewhere without surprise — but the substitution set is intentionally small
 * and well-known. See templates/README.md.
 */
export function substitutePlaceholders(
  content: string,
  substitutions: Record<string, string>,
): string {
  return content.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, key: string) => {
    return key in substitutions ? substitutions[key]! : match;
  });
}

/**
 * Read the local templates manifest. Used for the picker UI when running
 * against `WD_TEMPLATES_PATH` (development) or when shipping the manifest
 * embedded in the CLI. Returns the hardcoded fallback if reading fails.
 */
export function loadTemplateManifest(source: string): TemplateManifest {
  const localPath = source.startsWith("file://")
    ? source.slice("file://".length)
    : undefined;
  if (localPath) {
    const indexPath = join(localPath, "_index.json");
    if (existsSync(indexPath)) {
      try {
        return JSON.parse(readFileSync(indexPath, "utf-8")) as TemplateManifest;
      } catch {
        // fall through to default
      }
    }
  }
  return BUILT_IN_TEMPLATE_MANIFEST;
}

/**
 * Fetch a template into `targetDir` and apply placeholder substitutions.
 *
 * Two paths:
 *  - Local sources (`file://…`, set via `WD_TEMPLATES_PATH` for dev) get
 *    served by a recursive copy. giget doesn't have a native file: provider,
 *    and we don't want network at all when the user is iterating on a
 *    template they're editing on disk.
 *  - Everything else (`github:…`, `gitlab:…`, `bitbucket:…`, raw HTTP, full
 *    repo URLs) goes through giget's tarball download.
 */
export async function fetchTemplate(
  options: FetchTemplateOptions,
  substitutions: Record<string, string>,
): Promise<FetchTemplateResult> {
  const source = resolveTemplateSource({
    ...(options.source !== undefined ? { source: options.source } : {}),
  });
  const fullSource = options.templateName
    ? `${source}/${options.templateName}`
    : source;

  mkdirSync(options.targetDir, { recursive: true });

  if (fullSource.startsWith("file://")) {
    const localPath = fullSource.slice("file://".length);
    if (!existsSync(localPath)) {
      throw new Error(`Template not found at ${localPath}. Check WD_TEMPLATES_PATH or the template name.`);
    }
    cpSync(localPath, options.targetDir, { recursive: true, force: !!options.force });
  } else {
    await downloadTemplate(fullSource, {
      dir: options.targetDir,
      force: options.force ?? false,
      forceClean: false,
    });
  }

  const written = walk(options.targetDir).map((abs) => abs.slice(options.targetDir.length + 1));
  for (const relPath of written) {
    const fullPath = join(options.targetDir, relPath);
    if (!isLikelyText(fullPath)) continue;
    const before = readFileSync(fullPath, "utf-8");
    const after = substitutePlaceholders(before, substitutions);
    if (after !== before) writeFileSync(fullPath, after);
  }

  return {
    templateName: options.templateName,
    source: fullSource,
    targetDir: options.targetDir,
    files: written,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walk(abs));
    } else if (st.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Heuristic: substitute placeholders only in files that look like text. We
 * skip anything binary-ish (image extensions, etc.) to avoid corrupting bytes.
 * Generous on what counts as text — when in doubt we substitute, since
 * placeholders are valid bytes either way.
 */
function isLikelyText(filePath: string): boolean {
  const binaryExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".zip", ".tar", ".gz", ".tgz",
    ".pdf", ".mp4", ".mp3", ".wasm",
  ]);
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return !binaryExts.has(ext.toLowerCase());
}

/**
 * Derive substitutions from a target directory + optional project name.
 * Kept out of `createHelloStarter` and `fetchTemplate` so both code paths
 * agree on what tokens look like.
 */
export function deriveSubstitutions(targetDir: string, projectName?: string): Record<string, string> {
  const name = projectName ?? kebabCase(basename(targetDir));
  const title = humanTitle(name);
  return {
    projectName: name,
    projectTitle: title,
    compatibilityDate: new Date().toISOString().slice(0, 10),
  };
}

function kebabCase(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase() || "my-worker";
}

function humanTitle(input: string): string {
  return input
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

// Re-exported for the picker / scaffold dispatcher. Path utilities kept private.
export const __internals = { walk, isLikelyText };
// Re-exported above intentionally; mkdirSync/dirname stay imported because
// they may be used by callers that compose with this module — tree-shaken
// in production builds.
void mkdirSync;
void dirname;
