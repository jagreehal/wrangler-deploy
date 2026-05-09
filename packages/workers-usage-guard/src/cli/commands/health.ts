import type { ParsedArgs } from "../parse.js";
import { loadConfig, ENDPOINT_ENV } from "../config.js";
import { optionalString } from "../parse.js";

export const summary = "Ping the guard's unsigned /api/health endpoint";

export const help = `
wug health [--endpoint <url>]

Reads endpoint from --endpoint, $${ENDPOINT_ENV}, or wug.config.json.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const config = loadConfig({ cwd: process.cwd() });
  const endpoint = optionalString(args.flags, "endpoint") ?? process.env[ENDPOINT_ENV] ?? config.endpoint;
  if (!endpoint) throw new Error("endpoint required: pass --endpoint or set wug.config.json#endpoint");
  const url = new URL("/api/health", endpoint).toString();
  const res = await fetch(url);
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  console.log(JSON.stringify({ status: res.status, ok: res.ok, body }, null, 2));
  return res.ok ? 0 : 1;
}
