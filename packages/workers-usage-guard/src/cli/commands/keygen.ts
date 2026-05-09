import type { ParsedArgs } from "../parse.js";
import { generateSigningKey } from "../lib/cf.js";
import { boolFlag } from "../parse.js";

export const summary = "Generate a 32-byte hex signing key for the guard API";

export const help = `
wug keygen

Generate a fresh 32-byte hex signing key. Set it as GUARD_API_SIGNING_KEY when
running other commands. Never commit the key to wug.config.json.

Flags:
  --json   Print as JSON
`;

export async function run(args: ParsedArgs): Promise<number> {
  const key = generateSigningKey();
  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify({ signingKey: key }));
  } else {
    console.log(key);
  }
  return 0;
}
