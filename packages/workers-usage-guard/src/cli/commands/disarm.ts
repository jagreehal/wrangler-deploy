import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { optionalString } from "../parse.js";
import { createApiClient } from "../lib/api.js";

export const summary = "Add a script to runtime protection (block kill-switch)";

export const help = `
wug disarm <script> [--account <id>] [--reason <text>]
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const scriptName = args.positional[0];
  if (!scriptName) throw new Error("script name required, e.g. `wug disarm payment-api`");
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const reason = optionalString(args.flags, "reason");
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  const body: Record<string, string> = { accountId: account, scriptName, addedBy: "wug" };
  if (reason) body.reason = reason;
  await client.post("/api/disarm", body);
  console.log(`disarmed ${scriptName} on ${account}`);
  return 0;
}
