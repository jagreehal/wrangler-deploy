import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { createApiClient } from "../lib/api.js";

export const summary = "Remove a script from runtime protection";

export const help = `
wug arm <script> [--account <id>]
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const scriptName = args.positional[0];
  if (!scriptName) throw new Error("script name required, e.g. `wug arm payment-api`");
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  await client.delete("/api/disarm", { accountId: account, scriptName });
  console.log(`armed ${scriptName} on ${account}`);
  return 0;
}
