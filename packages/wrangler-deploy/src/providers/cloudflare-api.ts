import { AgentErrors } from "../core/cli-output.js";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareApiOptions {
  apiToken: string;
  accountId: string;
}

export type FetchFn = typeof fetch;

let cachedAccountId: string | null = null;

/**
 * Reset the cached account ID. Used for testing.
 */
export function resetCachedAccountId(): void {
  cachedAccountId = null;
}

/**
 * Resolve the Cloudflare account ID. Uses CLOUDFLARE_ACCOUNT_ID env var,
 * or fetches from the API using the token.
 */
export async function resolveAccountId(apiToken: string, fetchFn: FetchFn = fetch): Promise<string> {
  const envAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (envAccountId) return envAccountId;
  if (cachedAccountId) return cachedAccountId;

  const res = await fetchFn(`${CF_API_BASE}/accounts?page=1&per_page=1`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw AgentErrors.auth(
        `Failed to resolve Cloudflare account ID: ${res.status} ${body}`,
        "Check CLOUDFLARE_API_TOKEN is valid and has Account:Read permission.",
        { env: ["CLOUDFLARE_API_TOKEN"] },
      );
    }
    throw AgentErrors.network(
      `Failed to resolve Cloudflare account ID: ${res.status} ${body}`,
      "Retry. If persistent, check api.cloudflare.com reachability.",
    );
  }

  const data = await res.json() as { result: Array<{ id: string }> };
  if (!data.result?.[0]?.id) {
    throw AgentErrors.auth(
      "No Cloudflare accounts found for this API token",
      "Verify CLOUDFLARE_API_TOKEN belongs to an account with at least one workspace.",
      { env: ["CLOUDFLARE_API_TOKEN"] },
    );
  }

  cachedAccountId = data.result[0].id;
  return cachedAccountId;
}

/**
 * Make an authenticated Cloudflare API request.
 */
export async function cfApi(
  path: string,
  options: CloudflareApiOptions,
  init?: RequestInit,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  const url = `${CF_API_BASE}/accounts/${options.accountId}${path}`;
  const res = await fetchFn(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return res;
}

/**
 * Parse a Cloudflare API response and extract the result.
 */
export async function cfApiResult<T>(res: Response): Promise<T> {
  const body = await res.json() as { success: boolean; result: T; errors: Array<{ code: number; message: string }> };

  if (!body.success) {
    const errors = body.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") ?? "Unknown error";
    // Code 10000 specifically means account/token mismatch — auth, not network.
    const isAuth = body.errors?.some((e) => e.code === 10000 || e.code === 9109);
    if (isAuth) {
      throw AgentErrors.auth(
        `Cloudflare API error: ${errors}`,
        "Set CLOUDFLARE_ACCOUNT_ID to match the account that owns CLOUDFLARE_API_TOKEN.",
        { env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] },
      );
    }
    throw AgentErrors.network(
      `Cloudflare API error: ${errors}`,
      "Inspect the error code via `wd explain` and retry if transient.",
    );
  }

  return body.result;
}
