import type { ParsedArgs } from "../parse.js";
import { signRequest } from "workers-usage-guard-shared";
import { optionalString, requireString } from "../parse.js";
import { SIGNING_KEY_ENV } from "../config.js";

export const summary = "Generate signed headers for a manual guard API request";

export const help = `
wug sign --method <verb> --path <path> [--key <secret>] [--timestamp <iso>]

Print x-guard-timestamp and x-guard-signature headers for a request.
Reads --key first, then $${SIGNING_KEY_ENV}.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const method = (optionalString(args.flags, "method") ?? "GET").toUpperCase();
  const path = requireString(args.flags, "path");
  const key = optionalString(args.flags, "key") ?? process.env[SIGNING_KEY_ENV];
  if (!key) throw new Error(`--key is required (or export ${SIGNING_KEY_ENV})`);
  const timestamp = optionalString(args.flags, "timestamp") ?? new Date().toISOString();
  const signature = await signRequest({ method, path, timestamp, key });
  console.log(JSON.stringify({ headers: { "x-guard-timestamp": timestamp, "x-guard-signature": signature } }, null, 2));
  return 0;
}
