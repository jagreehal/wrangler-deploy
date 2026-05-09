import type { ParsedArgs } from "../parse.js";
import { loadConfig, listNotificationSecrets } from "../config.js";
import { boolFlag } from "../parse.js";
import { ensureWranglerAvailable, runWranglerCapture, packageRoot } from "../lib/wrangler.js";

export const summary = "Pre-deploy checks: required secrets present in the deployed Worker";

export const help = `
wug preflight [--json]

Runs after \`wug setup\` and before \`wug deploy\`. Verifies wrangler is
authed and lists any required secrets that are not yet set on the Worker.
`;

type Check = { name: string; ok: boolean; detail: string };

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  ensureWranglerAvailable(cwd);
  const config = loadConfig({ cwd });
  const checks: Check[] = [];

  const whoami = runWranglerCapture(["whoami"], packageRoot());
  const authed = whoami.code === 0 && /Account ID|email/i.test(whoami.stdout);
  checks.push({ name: "wrangler authenticated", ok: authed, detail: authed ? "ok" : "run `wrangler login`" });

  const required = ["CLOUDFLARE_API_TOKEN", "GUARD_API_SIGNING_KEY", ...listNotificationSecrets(config)];
  if (config.scriptName) {
    const list = runWranglerCapture(["secret", "list", "--name", config.scriptName], packageRoot());
    if (list.code === 0) {
      const present = new Set<string>();
      for (const m of list.stdout.matchAll(/"name":\s*"([^"]+)"/g)) present.add(m[1]!);
      for (const s of required) {
        const ok = present.has(s);
        checks.push({ name: `secret: ${s}`, ok, detail: ok ? "set" : `missing — run \`wrangler secret put ${s}\`` });
      }
    } else {
      checks.push({
        name: "secret list",
        ok: false,
        detail: `wrangler secret list failed (Worker may not be deployed yet): ${list.stdout.slice(0, 200)}`,
      });
    }
  } else {
    checks.push({ name: "scriptName configured", ok: false, detail: "missing in wug.config.json" });
  }

  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  return checks.every((c) => c.ok) ? 0 : 1;
}
