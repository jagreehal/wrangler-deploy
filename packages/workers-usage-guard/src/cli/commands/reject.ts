import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { createApiClient } from "../lib/api.js";

export const summary = "Reject a pending kill-switch action";

export const help = `
wug reject <approval-id> [--account <id>]
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const id = args.positional[0];
  if (!id) throw new Error("approval id required, e.g. `wug reject appr-123`");
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  await client.post(`/api/approvals/${id}/reject`, { accountId: account, decidedBy: "wug" });
  console.log(`rejected ${id}`);
  return 0;
}
