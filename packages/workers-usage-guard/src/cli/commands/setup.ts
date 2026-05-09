import type { ParsedArgs } from "../parse.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_CONFIG_FILE,
  DEFAULT_DATABASE_NAME,
  DEFAULT_SCRIPT_NAME,
  loadConfig,
  saveConfig,
  type WugConfig,
  type WugWorker,
} from "../config.js";
import { boolFlag, optionalString } from "../parse.js";
import {
  ensureWranglerAvailable,
  packageRoot,
  packageWranglerJsonc,
  renderWranglerConfig,
  runWranglerStreaming,
} from "../lib/wrangler.js";
import { putSecret } from "../lib/wrangler-secrets.js";
import { createD1Database, generateSigningKey, parseDeployedEndpoint } from "../lib/cf.js";
import { ask } from "../lib/prompt.js";

export const summary = "End-to-end install: D1 + signing key + secrets + deploy + health check";

export const help = `
wug setup [--account <id>] [--scripts <a,b,c>] [--billing-cycle-day <1-31>] [--api-token <token>] [--yes]

One-shot install. Walks through:
  1. Verify wrangler is installed and authed (\`wrangler whoami\`)
  2. Create or reuse a D1 database (\`workers-usage-guard\` by default)
  3. Generate a signing key (or reuse $GUARD_API_SIGNING_KEY)
  4. Write wug.config.json in the current directory
  5. Apply D1 migrations
  6. Set required secrets on the deployed Worker
  7. Deploy
  8. Poll /api/health until it responds
  9. Print the live endpoint URL

Pass --yes to skip prompts (CI). All required values must then be flags or env.
`;

async function runSetup(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  ensureWranglerAvailable(cwd);

  const yes = boolFlag(args.flags, "yes");
  const configPath = resolve(cwd, DEFAULT_CONFIG_FILE);
  const existing = existsSync(configPath) ? loadConfig({ cwd }) : ({} as WugConfig);

  let accountId = optionalString(args.flags, "account") ?? existing.accounts?.[0]?.accountId;
  if (!accountId) {
    if (yes) throw new Error("--account is required with --yes");
    accountId = await ask("Cloudflare account ID");
    if (!accountId) throw new Error("account ID is required");
  }

  const billingCycleDay = Number(
    args.flags["billing-cycle-day"] ?? existing.accounts?.[0]?.billingCycleDay ?? 1,
  );

  const scriptsArg =
    optionalString(args.flags, "scripts") ??
    (yes ? "" : await ask("Comma-separated scripts to monitor (or leave blank)"));
  const scripts = scriptsArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const workers: WugWorker[] = scripts.length > 0
    ? scripts.map((scriptName) => ({ scriptName, thresholds: { requests: 500_000, cpuMs: 5_000_000 } }))
    : (existing.accounts?.[0]?.workers ?? []);

  const databaseName = existing.databaseName ?? DEFAULT_DATABASE_NAME;
  const scriptName = existing.scriptName ?? DEFAULT_SCRIPT_NAME;

  let databaseId = optionalString(args.flags, "database-id") ?? existing.databaseId;
  if (!databaseId) {
    console.log(`Creating D1 database "${databaseName}"...`);
    const created = createD1Database({ name: databaseName, cwd: packageRoot() });
    databaseId = created.databaseId;
    console.log(`  database_id: ${databaseId}`);
  } else {
    console.log(`Reusing D1 database: ${databaseId}`);
  }

  const signingKey = optionalString(args.flags, "signing-key") ?? process.env.GUARD_API_SIGNING_KEY ?? generateSigningKey();
  const generatedKey = !optionalString(args.flags, "signing-key") && !process.env.GUARD_API_SIGNING_KEY;

  const apiToken =
    optionalString(args.flags, "api-token") ??
    process.env.CLOUDFLARE_API_TOKEN ??
    (yes ? null : (await ask("Cloudflare API token (with the scopes from the README)")) || null);
  if (!apiToken) throw new Error("Cloudflare API token is required (--api-token or $CLOUDFLARE_API_TOKEN)");

  const config: WugConfig = {
    ...existing,
    databaseId,
    databaseName,
    scriptName,
    accounts: [
      {
        accountId,
        billingCycleDay,
        workers,
        globalProtected: existing.accounts?.[0]?.globalProtected ?? [],
      },
    ],
    notifications: existing.notifications ?? { channels: [] },
    vars: existing.vars ?? {
      requestThreshold: 500_000,
      cpuTimeThresholdMs: 5_000_000,
      overageCooldownSeconds: 3600,
      overageGraceSeconds: 14_400,
    },
  };
  const written = saveConfig({ cwd, config });
  console.log(`Wrote ${written}`);

  const rendered = renderWranglerConfig({ config, baseConfigPath: packageWranglerJsonc() });
  try {
    console.log("Applying D1 migrations...");
    const mig = await runWranglerStreaming(
      ["d1", "migrations", "apply", databaseName, "--remote", "--config", rendered.path],
      packageRoot(),
    );
    if (mig.code !== 0) return mig.code;

    console.log("Deploying Worker (initial)...");
    const firstDeploy = await runWranglerStreaming(["deploy", "--config", rendered.path], packageRoot());
    if (firstDeploy.code !== 0) return firstDeploy.code;
    const endpoint = parseDeployedEndpoint(firstDeploy.stdout);
    if (endpoint) {
      saveConfig({ cwd, config: { ...config, endpoint } });
      console.log(`  endpoint: ${endpoint}`);
    }

    console.log("Setting secrets...");
    putSecret({ name: "CLOUDFLARE_API_TOKEN", value: apiToken, cwd: packageRoot(), configPath: rendered.path });
    putSecret({ name: "GUARD_API_SIGNING_KEY", value: signingKey, cwd: packageRoot(), configPath: rendered.path });

    if (endpoint) {
      console.log("Probing /api/health...");
      const ok = await pollHealth(endpoint, 30);
      console.log(ok ? "  ok ✓" : "  endpoint not responding yet — try `wug health` in a minute");
    }

    console.log("\n✓ setup complete");
    if (generatedKey) {
      console.log("\nIMPORTANT: save this signing key — you'll need it to call the API:");
      console.log(`  export GUARD_API_SIGNING_KEY=${signingKey}`);
    }
    if (endpoint) console.log(`\nNext: \`wug breaches\` or visit ${endpoint}/api/health`);
    return 0;
  } finally {
    rendered.cleanup();
  }
}

async function pollHealth(endpoint: string, maxSeconds: number): Promise<boolean> {
  const url = new URL("/api/health", endpoint).toString();
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export async function run(args: ParsedArgs): Promise<number> {
  return runSetup(args);
}
