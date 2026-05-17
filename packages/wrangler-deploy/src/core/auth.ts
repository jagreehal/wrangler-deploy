import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadProjectContext } from "./project-context.js";
import { AgentErrors } from "./cli-output.js";

const resolvedAccountIds = new Map<string, string>();
const whoamiSummaries = new Map<string, string>();

const ACCOUNT_ID_HEX = /^[a-f0-9]{32}$/i;

function assertAccountId32Hex(value: string, sourceLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw AgentErrors.config(
      `${sourceLabel} is set but empty after trimming. Use a 32-character hexadecimal Cloudflare account id.`,
      "Set a 32-character hexadecimal Cloudflare account id (Workers & Pages → account overview).",
    );
  }
  if (!ACCOUNT_ID_HEX.test(trimmed)) {
    throw AgentErrors.config(
      `${sourceLabel} must be a 32-character hexadecimal Cloudflare account id (Workers & Pages → account overview). ` +
        `Got ${JSON.stringify(trimmed)}.`,
      "Set a 32-character hexadecimal Cloudflare account id (Workers & Pages → account overview).",
    );
  }
  return trimmed.toLowerCase();
}

export function resetResolvedAccountId(): void {
  resolvedAccountIds.clear();
  whoamiSummaries.clear();
}

export interface AccountResolutionOptions {
  accountIdOverride?: string;
}

export interface ResolvedAccount {
  accountId: string;
  source: "flag" | "env" | "project-context" | "whoami" | "wrangler-config";
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
export function resolveAccountId(cwd: string, options?: AccountResolutionOptions): string {
  const projectContext = loadProjectContext(cwd);
  const cacheKey = [
    cwd,
    options?.accountIdOverride?.trim() ?? "",
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "",
    projectContext.accountId?.trim() ?? "",
    process.env.CLOUDFLARE_API_TOKEN ? "token" : "no-token",
  ].join("|");

  const cached = resolvedAccountIds.get(cacheKey);
  if (cached) return cached;

  // 0. Explicit account override (CLI flag)
  const rawOverride = options?.accountIdOverride;
  if (typeof rawOverride === "string" && rawOverride.trim()) {
    const overrideId = assertAccountId32Hex(rawOverride, "--account-id");
    resolvedAccountIds.set(cacheKey, overrideId);
    return overrideId;
  }

  // 1. CLOUDFLARE_ACCOUNT_ID (CI/CD and explicit local override)
  const rawEnvId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (typeof rawEnvId === "string" && rawEnvId.trim()) {
    const envId = assertAccountId32Hex(rawEnvId, "CLOUDFLARE_ACCOUNT_ID");
    resolvedAccountIds.set(cacheKey, envId);
    return envId;
  }

  // 2. accountId from .wdrc / .wdrc.json
  const rawContextId = projectContext.accountId;
  if (typeof rawContextId === "string" && rawContextId.trim()) {
    const projectContextAccountId = assertAccountId32Hex(rawContextId, ".wdrc / .wdrc.json accountId");
    resolvedAccountIds.set(cacheKey, projectContextAccountId);
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
      resolvedAccountIds.set(cacheKey, id);
      return id;
    }

    // Fallback: any 32-char hex that's not a common hash
    const hexMatch = output.match(/\b([a-f0-9]{32})\b/);
    const hexId = hexMatch?.[1];
    if (hexId) {
      const id = hexId.toLowerCase();
      resolvedAccountIds.set(cacheKey, id);
      return id;
    }
  } catch {
    // whoami failed — not logged in
  }

  if (process.env.CLOUDFLARE_API_TOKEN) {
    throw AgentErrors.auth(
      "CLOUDFLARE_API_TOKEN is set but the Cloudflare account ID could not be resolved.\n\n" +
        "  Set the account explicitly to avoid Cloudflare API error 10000 (token vs wrong account):\n" +
        "    • `CLOUDFLARE_ACCOUNT_ID` (32-character hex, Workers & Pages → account overview), or\n" +
        "    • `accountId` in `.wdrc` or `.wdrc.json` at the repo root, or\n" +
        "    • fix `wrangler whoami` with the same environment (token scopes / network).\n\n" +
        "  OAuth `~/.wrangler/config/default.toml` is not used when an API token is set,\n" +
        "  because it often reflects a different account than the token.\n",
      "Set CLOUDFLARE_ACCOUNT_ID or accountId in .wdrc to a 32-character hex Cloudflare account id.",
      { env: ["CLOUDFLARE_ACCOUNT_ID"] },
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
        resolvedAccountIds.set(cacheKey, id);
        return id;
      }
    } catch {
      // Ignore config parse failures and continue to the hard error below.
    }
  }

  throw AgentErrors.auth(
    "Could not resolve Cloudflare account ID.\n\n" +
      "  For local development: run `wrangler login`\n" +
      "  For CI/CD: set `CLOUDFLARE_API_TOKEN` plus an account id via `CLOUDFLARE_ACCOUNT_ID` or `accountId` in `.wdrc` / `.wdrc.json`\n",
    "Run `wrangler login` for local dev, or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID for CI.",
    { env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] },
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

export function resolveAccount(cwd: string, options?: AccountResolutionOptions): ResolvedAccount {
  const rawOverride = options?.accountIdOverride;
  if (typeof rawOverride === "string" && rawOverride.trim()) {
    return {
      accountId: resolveAccountId(cwd, options),
      source: "flag",
    };
  }
  if (typeof process.env.CLOUDFLARE_ACCOUNT_ID === "string" && process.env.CLOUDFLARE_ACCOUNT_ID.trim()) {
    return {
      accountId: resolveAccountId(cwd, options),
      source: "env",
    };
  }
  const projectContext = loadProjectContext(cwd);
  if (typeof projectContext.accountId === "string" && projectContext.accountId.trim()) {
    return {
      accountId: resolveAccountId(cwd, options),
      source: "project-context",
    };
  }

  const accountId = resolveAccountId(cwd, options);
  const source: ResolvedAccount["source"] = process.env.CLOUDFLARE_API_TOKEN ? "whoami" : "wrangler-config";
  return { accountId, source };
}

export function resolveWranglerWhoamiSummary(cwd: string): string {
  const cached = whoamiSummaries.get(cwd);
  if (cached) return cached;
  const output = execFileSync("npx", ["wrangler", "whoami"], {
    encoding: "utf-8",
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  const lines = text.split(/\r?\n/);
  let email: string | undefined;
  let accountName: string | undefined;
  let accountId: string | undefined;
  for (const line of lines) {
    if (!email) {
      const emailMatch = line.match(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/);
      if (emailMatch) email = emailMatch[0];
    }
    const accountMatch = line.match(/^\s*│?\s*(.+?)\s+│\s+([a-f0-9]{32})\s*│?\s*$/i)
      ?? line.match(/^\s*\|\s*(.+?)\s+\|\s+([a-f0-9]{32})\s*\|\s*$/i);
    if (accountMatch && !accountId) {
      accountName = (accountMatch[1] ?? "").trim();
      accountId = (accountMatch[2] ?? "").trim();
    }
  }
  let summary = "authenticated";
  if (email && accountId) summary = `${email} (account ${accountName ?? accountId})`;
  else if (email) summary = email;
  else if (accountId) summary = `account ${accountName ?? accountId}`;
  else {
    const firstNonBanner = lines.find((line) => line.trim() && !line.includes("wrangler") && !line.includes("─"));
    summary = firstNonBanner?.trim() ?? "authenticated";
  }
  whoamiSummaries.set(cwd, summary);
  return summary;
}
