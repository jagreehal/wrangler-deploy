import type { ParsedArgs } from "../parse.js";
import { loadConfig, saveConfig } from "../config.js";
import { parseDeployedEndpoint } from "../lib/cf.js";
import {
  ensureWranglerAvailable,
  packageRoot,
  packageWranglerJsonc,
  renderWranglerConfig,
  runWranglerStreaming,
} from "../lib/wrangler.js";

export const summary = "Deploy the guard Worker using wug.config.json";

export const help = `
wug deploy

Renders a wrangler.jsonc from the bundled template + your wug.config.json,
then runs wrangler deploy against the package's compiled Worker. The
deployed endpoint is stored back in wug.config.json on success.
`;

export async function run(_args: ParsedArgs): Promise<number> {
  const cwd = process.cwd();
  ensureWranglerAvailable(cwd);
  const config = loadConfig({ cwd });

  const rendered = renderWranglerConfig({ config, baseConfigPath: packageWranglerJsonc() });
  try {
    const result = await runWranglerStreaming(
      ["deploy", "--config", rendered.path],
      packageRoot(),
    );
    if (result.code !== 0) return result.code;
    const endpoint = parseDeployedEndpoint(result.stdout);
    if (endpoint && endpoint !== config.endpoint) {
      saveConfig({ cwd, config: { ...config, endpoint } });
      console.log(`\nSaved endpoint to wug.config.json: ${endpoint}`);
    }
    return 0;
  } finally {
    rendered.cleanup();
  }
}
