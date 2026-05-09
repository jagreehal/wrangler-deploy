import type { ParsedArgs } from "../parse.js";
import { loadConfig, resolveAccount, resolveEndpoint } from "../config.js";
import { boolFlag, optionalString, requireString } from "../parse.js";
import { createApiClient } from "../lib/api.js";
import { json, renderSnapshots, type SnapshotRow } from "../lib/output.js";

export const summary = "List recent usage snapshots for a script";

export const help = `
wug snapshots --script <name> [--account <id>] [--window <Nd|Nh>] [--json]

Default window is 24h.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig({ cwd });
  const account = resolveAccount({ config, flags: args.flags, env: process.env });
  const script = requireString(args.flags, "script");
  const window = optionalString(args.flags, "window") ?? "24h";
  const { endpoint, signingKey } = resolveEndpoint({ config, flags: args.flags, env: process.env });
  const client = createApiClient({ endpoint, signingKey });
  const res = await client.get<{ snapshots: SnapshotRow[] }>(
    `/api/snapshots?account=${encodeURIComponent(account)}&script=${encodeURIComponent(script)}&window=${encodeURIComponent(window)}`,
  );
  if (boolFlag(args.flags, "json")) {
    console.log(json(res.snapshots));
  } else {
    console.log(renderSnapshots(res.snapshots));
  }
  return 0;
}
