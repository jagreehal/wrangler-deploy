import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadProjectContext } from "./project-context.js";

const resolvedAccountIds = new Map<string, string>();

const ACCOUNT_ID_HEX = /^[a-f0-9]{32}$/i;

function assertAccountId32Hex(value: string, sourceLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(
      `${sourceLabel} is set but empty after trimming. Use a 32-character hexadecimal Cloudflare account id.`,
    );
  }
  if (!ACCOUNT_ID_HEX.test(trimmed)) {
    throw new Error(
      `${sourceLabel} must be a 32-character hexadecimal Cloudflare account id (Workers & Pages → account overview). ` +
        `Got ${JSON.stringify(trimmed)}.`,
    );
  }
  return trimmed.toLowerCase();
}

export function resetResolvedAccountId(): void {
  resolvedAccountIds.clear();
}

/**
 * Resolve the Cloudflare account ID for all wrangler commands.
 *
 * Resolution order:
 * 1. `CLOUDFLARE_ACCOUNT_ID` env var (explicit override, commonly in CI)
 * 2. `accountId` from project context (`.wdrc` / `.wdrc.json`) when present
 * 3. Parse from `wrangler whoami` (OAuth or API token — inherits current `process.env`)
 * 4. If **`CLOUDFLARE_API_TOKEN` is not set**: read `account_id` from `~/.wrangler/config/default.toml` when that file exists (OAuth login)
 *
 * When **`CLOUDFLARE_API_TOKEN`** is set, step 4 is skipped: `default.toml` reflects `wrangler login` (OAuth) and is often a *personal* account while the
 * token is for *work*, which produces Cloudflare API error 10000 (token vs account mismatch).
 *
 * The resolved ID is cached for the process lifetime and injected into the env for all
 * subsequent wrangler calls via `getWranglerEnv()`.
 */
export function resolveAccountId(cwd: string): string {
  const cached = resolvedAccountIds.get(cwd);
  if (cached) return cached;

  // 1. CLOUDFLARE_ACCOUNT_ID (CI/CD and explicit local override)
  const rawEnvId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (typeof rawEnvId === "string" && rawEnvId.trim()) {
    const envId = assertAccountId32Hex(rawEnvId, "CLOUDFLARE_ACCOUNT_ID");
    resolvedAccountIds.set(cwd, envId);
    return envId;
  }

  // 2. accountId from .wdrc / .wdrc.json
  const rawContextId = loadProjectContext(cwd).accountId;
  if (typeof rawContextId === "string" && rawContextId.trim()) {
    const projectContextAccountId = assertAccountId32Hex(rawContextId, ".wdrc / .wdrc.json accountId");
    resolvedAccountIds.set(cwd, projectContextAccountId);
    return projectContextAccountId;
  }

  // 3. Parse from wrangler whoami
  try {
    const output = execFileSync("npx", ["wrangler", "whoami"], {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Extract account ID from table output: "│ Account Name │ <32-char hex> │"
    const match = output.match(/│\s+\S.*?\s+│\s+([a-f0-9]{32})\s+│/);
    const matchedId = match?.[1];
    if (matchedId) {
      const id = matchedId.toLowerCase();
      resolvedAccountIds.set(cwd, id);
      return id;
    }

    // Fallback: any 32-char hex that's not a common hash
    const hexMatch = output.match(/\b([a-f0-9]{32})\b/);
    const hexId = hexMatch?.[1];
    if (hexId) {
      const id = hexId.toLowerCase();
      resolvedAccountIds.set(cwd, id);
      return id;
    }
  } catch {
    // whoami failed — not logged in
  }

  if (process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is set but the Cloudflare account ID could not be resolved.\n\n" +
        "  Set the account explicitly to avoid Cloudflare API error 10000 (token vs wrong account):\n" +
        "    • `CLOUDFLARE_ACCOUNT_ID` (32-character hex, Workers & Pages → account overview), or\n" +
        "    • `accountId` in `.wdrc` or `.wdrc.json` at the repo root, or\n" +
        "    • fix `wrangler whoami` with the same environment (token scopes / network).\n\n" +
        "  OAuth `~/.wrangler/config/default.toml` is not used when an API token is set,\n" +
        "  because it often reflects a different account than the token.\n",
    );
  }

  // 4. OAuth default.toml (only when no API token — see module JSDoc)
  const fallbackPath = process.env.HOME
    ? `${process.env.HOME}/.wrangler/config/default.toml`
    : undefined;
  if (fallbackPath && existsSync(fallbackPath)) {
    try {
      const content = readFileSync(fallbackPath, "utf-8");
      const match = content.match(/account_id\s*=\s*["']([a-f0-9]{32})["']/i);
      if (match?.[1]) {
        const id = match[1].toLowerCase();
        resolvedAccountIds.set(cwd, id);
        return id;
      }
    } catch {
      // Ignore config parse failures and continue to the hard error below.
    }
  }

  throw new Error(
    "Could not resolve Cloudflare account ID.\n\n" +
      "  For local development: run `wrangler login`\n" +
      "  For CI/CD: set `CLOUDFLARE_API_TOKEN` plus an account id via `CLOUDFLARE_ACCOUNT_ID` or `accountId` in `.wdrc` / `.wdrc.json`\n",
  );
}

/**
 * Get environment variables to pass to all wrangler child processes.
 * Ensures CLOUDFLARE_ACCOUNT_ID is always set so wrangler doesn't
 * prompt or fail on account resolution.
 */
export function getWranglerEnv(cwd: string): NodeJS.ProcessEnv {
  const accountId = resolveAccountId(cwd);
  return {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };
}
