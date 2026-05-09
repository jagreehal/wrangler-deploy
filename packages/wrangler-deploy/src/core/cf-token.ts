/**
 * Required Cloudflare API token scopes for wrangler-deploy operations.
 *
 * Each entry is a permission group + permission level pair as it appears
 * in the Cloudflare token-creation UI. Sourced from
 * https://developers.cloudflare.com/fundamentals/api/reference/permissions/
 *
 * Keep this list narrow — extra scopes are a security smell.
 */
export interface RequiredScope {
  group: string;
  level: "Read" | "Edit";
  why: string;
}

export const REQUIRED_SCOPES: readonly RequiredScope[] = [
  { group: "Account", level: "Read", why: "Resolve account ID for all operations" },
  { group: "User", level: "Read", why: "Verify token via /user/tokens/verify" },
  { group: "Workers Scripts", level: "Edit", why: "Deploy workers and read deploy state" },
  { group: "Workers KV Storage", level: "Edit", why: "Provision KV namespaces" },
  { group: "Workers R2 Storage", level: "Edit", why: "Provision R2 buckets" },
  { group: "D1", level: "Edit", why: "Provision D1 databases and run migrations" },
  { group: "Queues", level: "Edit", why: "Provision queues + bind producers/consumers" },
  { group: "Hyperdrive", level: "Edit", why: "Provision Hyperdrive configs" },
  { group: "Workers Routes", level: "Edit", why: "Bind workers to zone routes" },
  { group: "Workers Tail", level: "Read", why: "Tail logs via wrangler tail" },
  { group: "Workers Observability", level: "Read", why: "Read worker analytics for guard" },
] as const;

const TEMPLATE_PARAMS = [
  "permissionGroupKeys=%5B%22account%22%2C%22user%22%2C%22workers_scripts%22%2C%22workers_kv%22%2C%22workers_r2%22%2C%22d1%22%2C%22queues%22%2C%22hyperdrive%22%2C%22workers_routes%22%2C%22workers_tail%22%2C%22workers_observability%22%5D",
  "name=wrangler-deploy",
];

export function dashboardCreateUrl(): string {
  return `https://dash.cloudflare.com/profile/api-tokens?${TEMPLATE_PARAMS.join("&")}`;
}

export interface RenderTokenInstructionsOptions {
  profileName?: string;
}

export function renderTokenInstructions(
  options: RenderTokenInstructionsOptions = {},
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  wrangler-deploy needs a Cloudflare API token with these scopes:");
  lines.push("");
  for (const scope of REQUIRED_SCOPES) {
    lines.push(`    • ${scope.group.padEnd(28)} ${scope.level.padEnd(5)}  ${scope.why}`);
  }
  lines.push("");
  lines.push("  Create one at:");
  lines.push("");
  lines.push(`    ${dashboardCreateUrl()}`);
  lines.push("");
  lines.push("  After creating, save it with:");
  lines.push("");
  if (options.profileName && options.profileName !== "default") {
    lines.push(`    wd login --profile ${options.profileName}`);
  } else {
    lines.push("    wd login");
  }
  lines.push("");
  lines.push("  Or export directly for one-off use:");
  lines.push("");
  lines.push("    export CLOUDFLARE_API_TOKEN=cf_pat_...");
  lines.push("");
  return lines.join("\n");
}

export interface TokenInstructionsJson {
  scopes: ReadonlyArray<RequiredScope>;
  dashboardUrl: string;
  loginCommand: string;
}

export function tokenInstructionsJson(
  options: RenderTokenInstructionsOptions = {},
): TokenInstructionsJson {
  return {
    scopes: REQUIRED_SCOPES,
    dashboardUrl: dashboardCreateUrl(),
    loginCommand:
      options.profileName && options.profileName !== "default"
        ? `wd login --profile ${options.profileName}`
        : "wd login",
  };
}
