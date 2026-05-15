import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CfStageConfig } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { resolveDeployOrder } from "./graph.js";
import { validateSecrets } from "./secrets.js";
import { verify } from "./verify.js";
import { resolveAccountId } from "./auth.js";
import { appendDeployEvents } from "./history.js";
import { AgentErrors } from "./cli-output.js";

/**
 * Read the `account_id` field from a rendered wrangler.jsonc. Returns
 * undefined if the file is missing, unparseable, or has no account_id.
 * Stays narrow on purpose — full parsing happens in core/wrangler.ts.
 */
function readRenderedAccountId(renderedConfigPath: string): string | undefined {
  if (!existsSync(renderedConfigPath)) return undefined;
  try {
    const raw = readFileSync(renderedConfigPath, "utf-8");
    const stripped = raw.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (m) =>
      m.startsWith('"') ? m : "");
    const parsed = JSON.parse(stripped) as { account_id?: unknown };
    return typeof parsed.account_id === "string" ? parsed.account_id : undefined;
  } catch {
    return undefined;
  }
}

export type DeployArgs = {
  stage: string;
  verify?: boolean;
};

export type DeployDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
  logger?: Pick<Console, "log" | "warn" | "error">;
  validateSecretsFn?: typeof validateSecrets;
  verifyFn?: typeof verify;
};

export interface DeployedWorker {
  workerPath: string;
  name: string;
  renderedConfigPath: string;
  urls: string[];
  routes: string[];
  versionId?: string;
}

export interface DeployResult {
  stage: string;
  deployedWorkers: DeployedWorker[];
  missingSecrets: string[];
  verified: boolean;
}

function parseWranglerOutput(output: string): { urls: string[]; routes: string[]; versionId?: string } {
  const urls: string[] = [];
  const routes: string[] = [];
  let versionId: string | undefined;
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
      urls.push(trimmed);
    } else {
      const versionMatch = trimmed.match(/^Current Version ID:\s*(\S+)/i);
      if (versionMatch) {
        versionId = versionMatch[1];
        continue;
      }
      const routeLabelMatch = trimmed.match(/^route:\s*(.+)$/i);
      if (routeLabelMatch?.[1]) {
        routes.push(routeLabelMatch[1].trim());
        continue;
      }
      if (trimmed.includes("/*") && !trimmed.includes("://")) {
        routes.push(trimmed.replace(/^[-*]\s*/, ""));
      }
    }
  }
  return { urls, routes: [...new Set(routes)], versionId };
}

function dashboardUrl(accountId: string, workerName: string): string {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}`;
}

/**
 * Deploy all workers in deployOrder using the rendered wrangler configs.
 */
export async function deploy(args: DeployArgs, deps: DeployDeps): Promise<DeployResult> {
  const { stage } = args;
  const { rootDir, config, state: provider, wrangler, logger = console } = deps;
  const validateSecretsFn = deps.validateSecretsFn ?? validateSecrets;
  const verifyFn = deps.verifyFn ?? verify;
  const deployedWorkers: DeployedWorker[] = [];
  const missingSecrets = config.secrets ? await validateSecretsFn({ stage }, { rootDir, config, state: provider }) : [];

  const state = await provider.read(stage);
  if (!state) {
    throw AgentErrors.state(
      `No state found for stage "${stage}". Run "wrangler-deploy apply --stage ${stage}" first.`,
      `Run \`wd apply --stage ${stage}\` first.`,
    );
  }

  // Pre-deploy secret validation
  if (config.secrets) {
    if (missingSecrets.length > 0) {
      logger.log(`\n  Blocked: ${missingSecrets.length} missing secret(s):\n`);
      for (const m of missingSecrets) logger.log(`    x ${m}`);
      logger.log(
        `\n  Run "wrangler-deploy secrets set --stage ${stage}" or "wrangler-deploy secrets sync --to ${stage} --from-env-file .dev.vars"\n`,
      );
      throw AgentErrors.state("Deploy blocked by missing secrets. Set them first.", `Run \`wd secrets set --stage ${stage}\` to set the missing secrets.`);
    }
  }

  logger.log(`\n  wrangler-deploy deploy --stage ${stage}\n`);

  const deployOrder = resolveDeployOrder(config);
  if (deployOrder.length === 0) {
    logger.log(`  No workers configured. Run wd apply to provision resources, then deploy workers or deploy separately.\n`);
    return {
      stage,
      deployedWorkers: [],
      missingSecrets: [],
      verified: false,
    };
  }
  // Drift check: if the rendered config's account_id doesn't match the
  // currently-resolved account, deploying would hit the wrong account and
  // surface as the misleading WD_E_ACCOUNT_MISMATCH (CF API 10000). The
  // actual fix is `wd apply` to refresh the rendered config, so we catch it
  // here with a dedicated code that points at the right remediation.
  const currentAccountId = resolveAccountId(rootDir);
  for (const workerPath of deployOrder) {
    const renderedConfigPath = join(
      rootDir,
      ".wrangler-deploy",
      stage,
      workerPath,
      "wrangler.rendered.jsonc",
    );
    const renderedAccountId = readRenderedAccountId(renderedConfigPath);
    if (renderedAccountId && renderedAccountId !== currentAccountId) {
      throw AgentErrors.staleRender(
        `Rendered config for ${workerPath} pins account_id ${renderedAccountId}, but the current account is ${currentAccountId}. The state was applied against a different account.`,
        `Re-run \`wd apply --stage ${stage}\` to refresh the rendered config for the current account.`,
        { workerPath, stage, renderedAccountId, currentAccountId },
      );
    }

    const workerState = state.workers[workerPath];
    const workerName = workerState?.name ?? workerPath;

    logger.log(`  deploying ${workerName}...`);

    try {
      // Run from the worker directory so relative config fields resolve correctly.
      const workerDir = join(rootDir, workerPath);
      const output = wrangler.run(["deploy", "-c", renderedConfigPath], workerDir);

      const parsed = parseWranglerOutput(output);

      for (const line of output.split("\n")) {
        logger.log(`    ${line}`);
      }
      logger.log(``);

      if (workerState?.name) {
        const accountId = resolveAccountId(rootDir);
        const dash = dashboardUrl(accountId, workerState.name);
        const primaryUrl = parsed.urls[0] ?? dash;

        // Persist deployment info to state
        state.workers[workerPath] = {
          ...workerState,
          url: primaryUrl,
          urls: parsed.urls,
          routes: parsed.routes,
          versionId: parsed.versionId,
          deployed: true,
        };
        state.lastDeployedWorker = workerPath;
        state.updatedAt = new Date().toISOString();
        await provider.write(stage, state);

        deployedWorkers.push({
          workerPath,
          name: workerState.name,
          renderedConfigPath,
          urls: parsed.urls,
          routes: parsed.routes,
          versionId: parsed.versionId,
        });
      }
    } catch (err) {
      logger.error(`    FAILED to deploy ${workerPath}`);
      throw err;
    }
  }

  // Summary
  if (deployedWorkers.length > 0) {
    appendDeployEvents(state, deployedWorkers);
    state.updatedAt = new Date().toISOString();
    await provider.write(stage, state);

    const accountId = resolveAccountId(rootDir);
    logger.log(`  ─── ${stage} deployment summary ───\n`);
    for (const w of deployedWorkers) {
      const dash = dashboardUrl(accountId, w.name);
      logger.log(`  ${w.name}`);
      logger.log(`    Status: deployed`);
      if (w.versionId) logger.log(`    Version: ${w.versionId}`);
      if (w.urls.length > 0) {
        for (const url of w.urls) logger.log(`    URL:  ${url}`);
      }
      if (w.routes.length > 0) {
        for (const route of w.routes) logger.log(`    Route: ${route}`);
      }
      logger.log(`    Dashboard: ${dash}`);
      logger.log(``);
    }
  } else {
    logger.log(`  No workers deployed.\n`);
  }

  let verified = false;
  if (args.verify) {
    logger.log("  Running post-deploy verification...\n");
    // probeUrls: true so Cloudflare propagation hiccups (1104, 525, 526) absorb
    // into a brief retry loop instead of surfacing as a flaky deploy.
    const result = await verifyFn({ stage, probeUrls: true }, { rootDir, config, state: provider });

    for (const check of result.checks) {
      const icon = check.passed ? "+" : "x";
      logger.log(`  ${icon} ${check.name}${check.details ? ` — ${check.details}` : ""}`);
    }

    const passed = result.checks.filter((c) => c.passed).length;
    const failed = result.checks.filter((c) => !c.passed).length;
    logger.log(`\n  Verification: ${passed} passed, ${failed} failed\n`);
    verified = true;

    if (!result.passed) {
      throw AgentErrors.state("Post-deploy verification failed.", "Inspect the verification output and re-run `wd verify` after fixing the worker.");
    }
  }

  return {
    stage,
    deployedWorkers,
    missingSecrets,
    verified,
  };
}
