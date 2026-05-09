import type { ParsedArgs } from "../parse.js";
import { loadConfig, DEFAULT_DATABASE_NAME } from "../config.js";
import { boolFlag, optionalString } from "../parse.js";
import {
  ensureWranglerAvailable,
  packageRoot,
  packageWranglerJsonc,
  renderWranglerConfig,
  runWranglerStreaming,
} from "../lib/wrangler.js";

export const summary = "Apply D1 migrations for the guard database";

export const help = `
wug migrate [--local]

Applies migrations bundled with the package to the database referenced in
wug.config.json. Defaults to --remote; pass --local for the local D1 emulator.
`;

export async function run(args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  ensureWranglerAvailable(cwd);
  const config = loadConfig({ cwd });
  const databaseName = optionalString(args.flags, "database") ?? config.databaseName ?? DEFAULT_DATABASE_NAME;
  const local = boolFlag(args.flags, "local");
  const mode = local ? "--local" : "--remote";

  const rendered = renderWranglerConfig({ config, baseConfigPath: packageWranglerJsonc() });
  try {
    const result = await runWranglerStreaming(
      ["d1", "migrations", "apply", databaseName, mode, "--config", rendered.path],
      packageRoot(),
    );
    return result.code;
  } finally {
    rendered.cleanup();
  }
}
