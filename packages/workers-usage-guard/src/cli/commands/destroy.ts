import type { ParsedArgs } from "../parse.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, DEFAULT_SCRIPT_NAME } from "../config.js";
import { boolFlag } from "../parse.js";
import {
  ensureWranglerAvailable,
  packageRoot,
  runWranglerStreaming,
} from "../lib/wrangler.js";

export const summary = "Delete the guard Worker (and optionally its D1 database)";

export const help = `
wug destroy [--keep-data] [--yes]

Deletes the deployed guard Worker. With --keep-data, leaves the D1 database
in place; otherwise also deletes the configured database.

Always prompts unless --yes is passed.
`;

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  ensureWranglerAvailable(cwd);
  const config = loadConfig({ cwd });
  const scriptName = config.scriptName ?? DEFAULT_SCRIPT_NAME;
  const keepData = boolFlag(args.flags, "keep-data");
  const yes = boolFlag(args.flags, "yes");

  if (!yes) {
    const ok = await confirm(`Delete Worker "${scriptName}"${keepData ? "" : " and its D1 database"}?`);
    if (!ok) {
      console.log("Aborted.");
      return 1;
    }
  }

  const deleteScript = await runWranglerStreaming(["delete", "--name", scriptName], packageRoot());
  if (deleteScript.code !== 0) return deleteScript.code;

  if (!keepData && config.databaseName) {
    const deleteDb = await runWranglerStreaming(
      ["d1", "delete", config.databaseName, "--yes"],
      packageRoot(),
    );
    if (deleteDb.code !== 0) return deleteDb.code;
  }

  return 0;
}
