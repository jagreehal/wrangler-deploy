import { join } from "node:path";
import type { CfStageConfig } from "../types.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { resolveDeployOrder } from "./graph.js";
import { validateSecrets } from "./secrets.js";
import { verify } from "./verify.js";

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

export interface DeployResult {
  stage: string;
  deployedWorkers: Array<{
    workerPath: string;
    name: string;
    renderedConfigPath: string;
  }>;
  missingSecrets: string[];
  verified: boolean;
}

/**
 * Deploy all workers in deployOrder using the rendered wrangler configs.
 */
export async function deploy(args: DeployArgs, deps: DeployDeps): Promise<DeployResult> {
  const { stage } = args;
  const { rootDir, config, state: provider, wrangler, logger = console } = deps;
  const validateSecretsFn = deps.validateSecretsFn ?? validateSecrets;
  const verifyFn = deps.verifyFn ?? verify;
  const deployedWorkers: DeployResult["deployedWorkers"] = [];
  const missingSecrets = config.secrets ? await validateSecretsFn({ stage }, { rootDir, config, state: provider }) : [];

  const state = await provider.read(stage);
  if (!state) {
    throw new Error(
      `No state found for stage "${stage}". Run "wrangler-deploy apply --stage ${stage}" first.`,
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
      throw new Error("Deploy blocked by missing secrets. Set them first.");
    }
  }

  logger.log(`\n  wrangler-deploy deploy --stage ${stage}\n`);

  const deployOrder = resolveDeployOrder(config);
  for (const workerPath of deployOrder) {
    const renderedConfigPath = join(
      rootDir,
      ".wrangler-deploy",
      stage,
      workerPath,
      "wrangler.rendered.jsonc",
    );

    const workerState = state.workers[workerPath];

    logger.log(`  deploying ${workerState?.name ?? workerPath}...`);

    try {
      // Run from the worker directory so relative config fields resolve correctly.
      const workerDir = join(rootDir, workerPath);
      wrangler.run(["deploy", "-c", renderedConfigPath], workerDir);
      logger.log(`    deployed\n`);
      if (workerState?.name) {
        deployedWorkers.push({
          workerPath,
          name: workerState.name,
          renderedConfigPath,
        });
      }
    } catch (err) {
      logger.error(`    FAILED to deploy ${workerPath}`);
      throw err;
    }
  }

  logger.log(`  All workers deployed.\n`);

  let verified = false;
  if (args.verify) {
    logger.log("  Running post-deploy verification...\n");
    const result = await verifyFn({ stage }, { rootDir, config, state: provider });

    for (const check of result.checks) {
      const icon = check.passed ? "+" : "x";
      logger.log(`  ${icon} ${check.name}${check.details ? ` — ${check.details}` : ""}`);
    }

    const passed = result.checks.filter((c) => c.passed).length;
    const failed = result.checks.filter((c) => !c.passed).length;
    logger.log(`\n  Verification: ${passed} passed, ${failed} failed\n`);
    verified = true;

    if (!result.passed) {
      throw new Error("Post-deploy verification failed.");
    }
  }

  return {
    stage,
    deployedWorkers,
    missingSecrets,
    verified,
  };
}
