import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { boolFlag } from "../parse.js";
import { createApiClient } from "../lib/api.js";
import { json, renderRuntimeProtected, type RuntimeProtectedRow } from "../lib/output.js";

export const summary = "List scripts currently runtime-protected (disarmed)";

export const help = `
wug runtime-protected [--account <id>] [--json]
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  const res = await client.get<{ items: RuntimeProtectedRow[] }>(
    `/api/runtime-protected?account=${encodeURIComponent(account)}`,
  );
  if (boolFlag(args.flags, "json")) {
    console.log(json(res.items));
  } else {
    console.log(renderRuntimeProtected(res.items));
  }
  return 0;
}
