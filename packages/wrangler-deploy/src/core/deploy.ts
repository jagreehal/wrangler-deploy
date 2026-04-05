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
  validateSecretsFn?: typeof validateSecrets;
  verifyFn?: typeof verify;
};

/**
 * Deploy all workers in deployOrder using the rendered wrangler configs.
 */
export async function deploy(args: DeployArgs, deps: DeployDeps): Promise<void> {
  const { stage } = args;
  const { rootDir, config, state: provider, wrangler } = deps;
  const validateSecretsFn = deps.validateSecretsFn ?? validateSecrets;
  const verifyFn = deps.verifyFn ?? verify;

  const state = await provider.read(stage);
  if (!state) {
    throw new Error(
      `No state found for stage "${stage}". Run "wrangler-deploy apply --stage ${stage}" first.`,
    );
  }

  // Pre-deploy secret validation
  if (config.secrets) {
    const missing = await validateSecretsFn({ stage }, { rootDir, config, state: provider });
    if (missing.length > 0) {
      console.log(`\n  Blocked: ${missing.length} missing secret(s):\n`);
      for (const m of missing) console.log(`    x ${m}`);
      console.log(
        `\n  Run "wrangler-deploy secrets set --stage ${stage}" or "wrangler-deploy secrets sync --to ${stage} --from-env-file .dev.vars"\n`,
      );
      throw new Error("Deploy blocked by missing secrets. Set them first.");
    }
  }

  console.log(`\n  wrangler-deploy deploy --stage ${stage}\n`);

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

    console.log(`  deploying ${workerState?.name ?? workerPath}...`);

    try {
      // Run from the worker directory so relative config fields resolve correctly.
      const workerDir = join(rootDir, workerPath);
      wrangler.run(["deploy", "-c", renderedConfigPath], workerDir);
      console.log(`    deployed\n`);
    } catch (err) {
      console.error(`    FAILED to deploy ${workerPath}`);
      throw err;
    }
  }

  console.log(`  All workers deployed.\n`);

  if (args.verify) {
    console.log("  Running post-deploy verification...\n");
    const result = await verifyFn({ stage }, { rootDir, config, state: provider });

    for (const check of result.checks) {
      const icon = check.passed ? "+" : "x";
      console.log(`  ${icon} ${check.name}${check.details ? ` — ${check.details}` : ""}`);
    }

    const passed = result.checks.filter((c) => c.passed).length;
    const failed = result.checks.filter((c) => !c.passed).length;
    console.log(`\n  Verification: ${passed} passed, ${failed} failed\n`);

    if (!result.passed) {
      throw new Error("Post-deploy verification failed.");
    }
  }
}
