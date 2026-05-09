import type { ParsedArgs } from "../parse.js";
import { loadConfig, listNotificationSecrets } from "../config.js";
import { boolFlag } from "../parse.js";

export const summary = "List required secrets for the configured guard";

export const help = `
wug secret-audit [--json]

Prints the complete list of secrets the deployed guard will need, derived
from wug.config.json (notifications + always-required).
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const required = [
    { name: "CLOUDFLARE_API_TOKEN", source: "always required" },
    { name: "GUARD_API_SIGNING_KEY", source: "always required" },
    ...listNotificationSecrets(config).map((name) => ({ name, source: "notification channel" })),
  ];
  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify({ required }, null, 2));
  } else {
    for (const r of required) console.log(`${r.name}  (${r.source})`);
  }
  return 0;
}
