import type { ParsedArgs } from "../parse.js";
import { loadConfig, DEFAULT_SCRIPT_NAME } from "../config.js";
import { ensureWranglerAvailable, packageRoot, runWranglerStreaming } from "../lib/wrangler.js";

export const summary = "Tail logs from the deployed guard Worker";

export const help = `
wug logs [--format <pretty|json>]

Shells to wrangler tail against the configured script.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  ensureWranglerAvailable(cwd);
  const config = loadConfig({ cwd });
  const scriptName = config.scriptName ?? DEFAULT_SCRIPT_NAME;
  const format = typeof args.flags.format === "string" ? args.flags.format : "pretty";
  const result = await runWranglerStreaming(["tail", scriptName, "--format", format], packageRoot());
  return result.code;
}
