import type { ParsedArgs } from "../parse.js";
import {
  loadConfig,
  listNotificationSecrets,
  ENDPOINT_ENV,
  SIGNING_KEY_ENV,
} from "../config.js";
import { boolFlag } from "../parse.js";

export const summary = "Validate wug.config.json, environment, and (optionally) endpoint reachability";

export const help = `
wug doctor [--json]

Reports any missing configuration, env vars, or endpoint reachability issues.
Exits non-zero if any check fails.
`;

type Check = { name: string; ok: boolean; detail: string };

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const checks: Check[] = [];

  checks.push({
    name: "wug.config.json present",
    ok: Boolean(config.accounts || config.endpoint || config.databaseId),
    detail: config.accounts || config.endpoint
      ? "found"
      : "missing or empty — run `wug init` or `wug setup`",
  });

  checks.push({
    name: "accounts configured",
    ok: (config.accounts?.length ?? 0) > 0,
    detail: `${config.accounts?.length ?? 0} account(s)`,
  });

  checks.push({
    name: "databaseId configured",
    ok: Boolean(config.databaseId),
    detail: config.databaseId ?? "missing — required for deploy/migrate",
  });

  const hasEndpoint = Boolean(config.endpoint || process.env[ENDPOINT_ENV]);
  checks.push({
    name: "endpoint resolvable",
    ok: hasEndpoint,
    detail: config.endpoint ?? process.env[ENDPOINT_ENV] ?? `set ${ENDPOINT_ENV} or wug.config.json#endpoint`,
  });

  const hasSigningKey = Boolean(process.env[SIGNING_KEY_ENV]);
  checks.push({
    name: "signing key in env",
    ok: hasSigningKey,
    detail: hasSigningKey ? "set" : `export ${SIGNING_KEY_ENV} (generate with \`wug keygen\`)`,
  });

  const notifSecrets = listNotificationSecrets(config);
  checks.push({
    name: "notification channels",
    ok: true,
    detail: notifSecrets.length > 0 ? `${notifSecrets.length} configured` : "none configured",
  });

  if (hasEndpoint) {
    const endpoint = config.endpoint ?? process.env[ENDPOINT_ENV]!;
    try {
      const res = await fetch(new URL("/api/health", endpoint).toString());
      checks.push({
        name: "endpoint reachable",
        ok: res.ok,
        detail: `${res.status} ${res.statusText}`,
      });
    } catch (e) {
      checks.push({ name: "endpoint reachable", ok: false, detail: (e as Error).message });
    }
  }

  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    for (const c of checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    }
  }
  return checks.every((c) => c.ok) ? 0 : 1;
}
