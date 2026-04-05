import { execFileSync } from "node:child_process";

let resolvedAccountId: string | null = null;

/**
 * Resolve the Cloudflare account ID for all wrangler commands.
 *
 * Resolution order:
 * 1. CLOUDFLARE_ACCOUNT_ID env var (explicit, used in CI)
 * 2. Parse from `wrangler whoami` output (local OAuth login)
 *
 * The resolved ID is cached for the process lifetime and injected
 * into the env for all subsequent wrangler calls via `getWranglerEnv()`.
 *
 * This is needed because wrangler's OAuth flow doesn't always auto-detect
 * the account ID for write operations, even when `wrangler whoami` succeeds.
 */
export function resolveAccountId(cwd: string): string {
  if (resolvedAccountId) return resolvedAccountId;

  // 1. Check env var (CI/CD flow)
  const envId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (envId) {
    resolvedAccountId = envId;
    return envId;
  }

  // 2. Parse from wrangler whoami
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
      resolvedAccountId = matchedId;
      return matchedId;
    }

    // Fallback: any 32-char hex that's not a common hash
    const hexMatch = output.match(/\b([a-f0-9]{32})\b/);
    const hexId = hexMatch?.[1];
    if (hexId) {
      resolvedAccountId = hexId;
      return hexId;
    }
  } catch {
    // whoami failed — not logged in
  }

  throw new Error(
    "Could not resolve Cloudflare account ID.\n\n" +
    "  For local development: run `wrangler login`\n" +
    "  For CI/CD: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID\n"
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
