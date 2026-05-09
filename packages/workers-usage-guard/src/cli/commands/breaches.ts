import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { boolFlag, optionalString } from "../parse.js";
import { createApiClient } from "../lib/api.js";
import { json, renderBreaches, type BreachRow } from "../lib/output.js";

export const summary = "List recent breaches";

export const help = `
wug breaches [--account <id>] [--limit <n>] [--json]

Reads from the deployed guard's signed /api/breaches endpoint.
Defaults to the first account in wug.config.json.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const limit = Number(optionalString(args.flags, "limit") ?? 20);
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  const path = `/api/breaches?account=${encodeURIComponent(account)}&limit=${limit}`;
  const res = await client.get<{ breaches: BreachRow[] }>(path);
  if (boolFlag(args.flags, "json")) {
    console.log(json(res.breaches));
  } else {
    console.log(renderBreaches(res.breaches));
  }
  return 0;
}
