import { execFileSync } from "node:child_process";
import { throwAgentError } from "./cli-output.js";

/**
 * Minimum required wrangler version.
 *
 * Floor reasoning (do not lower without re-auditing — see audit notes below):
 *
 * `wrangler-deploy` shells out to `npx wrangler ...` for: `deploy`, `tail`,
 * `dev`, `whoami`, `secret list/put`, `d1 create/delete/execute/migrations apply`
 * (with `-c <path-to-wrangler.jsonc>`, `--remote`/`--local`, `--command`,
 * `--file`, `-y`, `--migrations-folder`, `--migrations-table`),
 * `r2 bucket create/delete`, `vectorize create/delete`.
 *
 * The tightest gate is the `-c <wrangler.jsonc>` config flag: native
 * `wrangler.json(c)` support was turned on by default in wrangler 3.91.0
 * (workers-sdk #7230). Below 3.91.0 you had to pass an experimental flag,
 * which `wd` does not, so the rendered config wouldn't be honored.
 *
 * Nothing in the audited call-set is wrangler-4-only — we do not use any
 * D1 sessions / preview-aliases / mixed-mode dev features. The peer range
 * is therefore `>=3.91.0 <5` (cap at 5 so a future v5 with breaking
 * changes is flagged loudly rather than silently consumed).
 */
export const MIN_WRANGLER_VERSION = "3.91.0";
export const MAX_WRANGLER_VERSION_EXCLUSIVE_MAJOR = 5;

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(input: string): ParsedSemver | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(input);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Returns -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Parse the version number from `wrangler --version` output.
 * Examples:
 *   "wrangler 3.91.0"
 *   " ⛅️ wrangler 4.88.0 (update available 4.92.0)"
 *   "3.50.0"
 */
export function parseWranglerVersionOutput(raw: string): string | undefined {
  const match = /(\d+\.\d+\.\d+)/.exec(raw);
  return match?.[1];
}

export type VersionCheckResult =
  | { kind: "ok"; version: string }
  | { kind: "not-installed"; cause?: unknown }
  | { kind: "unparseable"; raw: string }
  | { kind: "too-old"; version: string }
  | { kind: "too-new"; version: string };

export interface VersionCheckDeps {
  /** Override for tests; defaults to spawning `npx wrangler --version`. */
  readVersion?: () => string;
}

function defaultReadVersion(): string {
  return execFileSync("npx", ["wrangler", "--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Pure (no IO, no throw) — evaluate the result of a version read. */
export function evaluateVersion(raw: string | undefined, options?: {
  min?: string;
  maxMajorExclusive?: number;
}): VersionCheckResult {
  if (raw === undefined) return { kind: "not-installed" };
  const version = parseWranglerVersionOutput(raw);
  if (!version) return { kind: "unparseable", raw };
  const parsed = parseSemver(version)!;
  const min = parseSemver(options?.min ?? MIN_WRANGLER_VERSION)!;
  const maxMajor = options?.maxMajorExclusive ?? MAX_WRANGLER_VERSION_EXCLUSIVE_MAJOR;
  if (compareSemver(parsed, min) < 0) return { kind: "too-old", version };
  if (parsed.major >= maxMajor) return { kind: "too-new", version };
  return { kind: "ok", version };
}

let cachedResult: VersionCheckResult | undefined;

/** For tests. */
export function resetWranglerVersionCache(): void {
  cachedResult = undefined;
}

/**
 * Verify the installed wrangler satisfies the peer range. Runs once per
 * process and caches the result — subsequent calls are free.
 *
 * Throws an AgentErrorException (WD_E_DEPS_MISSING / WD_E_VALIDATION) on
 * failure so the CLI's existing error envelope is used.
 */
export function assertWranglerVersion(deps?: VersionCheckDeps): void {
  // Escape hatch for tests, CI bootstrapping, or users on a private wrangler
  // fork. Documented but unadvertised — production users should fix the
  // peer mismatch instead.
  if (process.env.WD_SKIP_WRANGLER_VERSION_CHECK === "1") return;

  if (cachedResult?.kind === "ok") return;

  if (!cachedResult) {
    const readVersion = deps?.readVersion ?? defaultReadVersion;
    let raw: string | undefined;
    try {
      raw = readVersion();
    } catch (cause) {
      cachedResult = { kind: "not-installed", cause };
      throwAgentError({
        type: "config",
        code: "WD_E_DEPS_MISSING",
        message: "wrangler is not installed (or not on PATH).",
        retryable: false,
        fix: "Add wrangler as a devDependency: `pnpm add -D wrangler@latest` (or npm/yarn equivalent).",
      });
    }
    cachedResult = evaluateVersion(raw);
  }

  const result = cachedResult;
  switch (result.kind) {
    case "ok":
      return;
    case "not-installed":
      throwAgentError({
        type: "config",
        code: "WD_E_DEPS_MISSING",
        message: "wrangler is not installed (or not on PATH).",
        retryable: false,
        fix: "Add wrangler as a devDependency: `pnpm add -D wrangler@latest`.",
      });
    case "unparseable":
      throwAgentError({
        type: "validation",
        code: "WD_E_VALIDATION",
        message: `Could not parse \`wrangler --version\` output: ${result.raw.slice(0, 200)}`,
        retryable: false,
        fix: "Verify `npx wrangler --version` prints a semver-like string.",
      });
    case "too-old":
      throwAgentError({
        type: "validation",
        code: "WD_E_DEPS_MISSING",
        message: `wrangler-deploy requires wrangler >=${MIN_WRANGLER_VERSION} (found ${result.version}).`,
        retryable: false,
        fix: "Update with: `pnpm add -D wrangler@latest` (or npm/yarn equivalent).",
      });
    case "too-new":
      throwAgentError({
        type: "validation",
        code: "WD_E_DEPS_MISSING",
        message: `wrangler-deploy supports wrangler <${MAX_WRANGLER_VERSION_EXCLUSIVE_MAJOR} (found ${result.version}). This wrangler-deploy version has not been tested against the new major.`,
        retryable: false,
        fix: `Pin wrangler to a supported major (>=${MIN_WRANGLER_VERSION} <${MAX_WRANGLER_VERSION_EXCLUSIVE_MAJOR}), or upgrade wrangler-deploy.`,
      });
  }
}
