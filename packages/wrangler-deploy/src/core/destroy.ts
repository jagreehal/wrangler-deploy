import type { CfStageConfig } from "../types.js";
import { resourceId, resourceStagedName } from "../types.js";
import { isStageProtected } from "./naming.js";
import type { StateProvider } from "./state.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { resolveDeployOrder } from "./graph.js";
import { deleteD1Database } from "../providers/d1.js";
import { deleteR2Bucket } from "../providers/r2.js";
import { deleteVectorizeIndex } from "../providers/vectorize.js";

export type DestroyArgs = {
  stage: string;
  force?: boolean;
};

export type DestroyDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
  logger?: Pick<Console, "log" | "warn" | "error">;
};

export interface DestroyResult {
  stage: string;
  detachedConsumers: Array<{ queue: string; worker: string }>;
  destroyedWorkers: string[];
  destroyedResources: string[];
  stateDeleted: boolean;
  partialFailures: boolean;
}

function wranglerWithIdempotentDelete(runner: WranglerRunner, args: string[], cwd: string): string {
  try {
    return runner.run(args, cwd);
  } catch (err: unknown) {
    const message = (err as Error).message || "";
    // Not found / doesn't exist is fine during destroy — resource already gone
    if (
      message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("No worker consumer") ||
      message.includes("404") ||
      message.includes("10007") ||
      message.includes("10090") // Worker does not exist on this account
    ) {
      return message;
    }
    throw err;
  }
}

export async function destroy(args: DestroyArgs, deps: DestroyDeps): Promise<DestroyResult> {
  const { stage, force } = args;
  const { rootDir, config, state: provider, wrangler, logger = console } = deps;

  if (isStageProtected(stage, config.stages) && !force) {
    throw new Error(`Stage "${stage}" is protected. Use --force to destroy it.`);
  }

  const state = await provider.read(stage);
  if (!state) {
    logger.log(`  No state found for stage "${stage}". Nothing to destroy.`);
    return {
      stage,
      detachedConsumers: [],
      destroyedWorkers: [],
      destroyedResources: [],
      stateDeleted: false,
      partialFailures: false,
    };
  }

  logger.log(`\n  wrangler-deploy destroy --stage ${stage}\n`);

  // Track whether any deletion fails — if so, preserve state for recovery
  let hasFailures = false;
  const destroyedWorkers: string[] = [];
  const destroyedResources: string[] = [];
  const detachedConsumerList: Array<{ queue: string; worker: string }> = [];

  // First: remove queue consumers (must happen before worker deletion).
  // Walk config.resources for known consumer bindings.
  const detachedConsumers = new Set<string>(); // "queueName:workerName" pairs already handled
  for (const [logicalName, resource] of Object.entries(config.resources)) {
    if (resource.type !== "queue") continue;
    for (const [workerPath, binding] of Object.entries(resource.bindings)) {
      if (typeof binding === "object" && "consumer" in binding) {
        const workerState = state.workers[workerPath];
        if (!workerState) continue;
        const stateRes = state.resources[logicalName];
        const queueName = stateRes ? resourceStagedName(stateRes) : undefined;
        if (!queueName) continue;
        detachedConsumers.add(`${queueName}:${workerState.name}`);
        detachedConsumerList.push({ queue: queueName, worker: workerState.name });
        logger.log(`  - removing queue consumer ${workerState.name} from ${queueName}...`);
        try {
          wranglerWithIdempotentDelete(
            wrangler,
            ["queues", "consumer", "remove", queueName, workerState.name],
            rootDir,
          );
          logger.log(`    removed`);
        } catch (err) {
          hasFailures = true;
          logger.error(`    FAILED: ${(err as Error).message}`);
        }
      }
    }
  }

  // Also detach consumers for queues that exist in state but were removed from config.
  // State doesn't track consumer vs producer, so try removing every worker as a consumer
  // from every orphaned queue — wranglerWithIdempotentDelete handles "No worker consumer".
  for (const [logicalName, resource] of Object.entries(state.resources)) {
    if (resource.type !== "queue") continue;
    if (config.resources[logicalName]) continue; // already handled above
    const queueName = resourceStagedName(resource);
    for (const [, workerState] of Object.entries(state.workers)) {
      const key = `${queueName}:${workerState.name}`;
      if (detachedConsumers.has(key)) continue;
      detachedConsumers.add(key);
      logger.log(`  - removing queue consumer ${workerState.name} from ${queueName}...`);
      try {
        wranglerWithIdempotentDelete(
          wrangler,
          ["queues", "consumer", "remove", queueName, workerState.name],
          rootDir,
        );
        logger.log(`    removed`);
      } catch (err) {
        hasFailures = true;
        logger.error(`    FAILED: ${(err as Error).message}`);
      }
    }
  }

  // Delete workers (reverse deploy order for config-known workers first)
  const reverseDeployOrder = [...resolveDeployOrder(config)].reverse();
  for (const workerPath of reverseDeployOrder) {
    const workerState = state.workers[workerPath];
    if (!workerState) continue;

    logger.log(`  - deleting worker ${workerState.name}...`);
    try {
      wranglerWithIdempotentDelete(
        wrangler,
        ["delete", "--name", workerState.name, "--force"],
        rootDir,
      );
      delete state.workers[workerPath];
      destroyedWorkers.push(workerState.name);
      await provider.write(stage, state);
      logger.log(`    deleted`);
    } catch (err) {
      hasFailures = true;
      logger.error(`    FAILED: ${(err as Error).message}`);
    }
  }

  // Delete orphaned workers still in state but no longer in config
  for (const [workerPath, workerState] of Object.entries(state.workers)) {
    logger.log(`  - deleting orphaned worker ${workerState.name}...`);
    try {
      wranglerWithIdempotentDelete(
        wrangler,
        ["delete", "--name", workerState.name, "--force"],
        rootDir,
      );
      delete state.workers[workerPath];
      destroyedWorkers.push(workerState.name);
      await provider.write(stage, state);
      logger.log(`    deleted`);
    } catch (err) {
      hasFailures = true;
      logger.error(`    FAILED: ${(err as Error).message}`);
    }
  }

  // Delete resources in reverse order
  const resourceNames = Object.keys(state.resources).reverse();
  for (const logicalName of resourceNames) {
    const resource = state.resources[logicalName];
    if (!resource) continue;
    if (resource.source !== "managed") continue;

    logger.log(`  - deleting ${resourceStagedName(resource)} (${resource.type})...`);

    try {
      switch (resource.type) {
        case "kv": {
          const rid = resourceId(resource);
          if (rid) {
            wranglerWithIdempotentDelete(
              wrangler,
              ["kv", "namespace", "delete", "--namespace-id", rid],
              rootDir,
            );
          }
          break;
        }
        case "queue":
          wranglerWithIdempotentDelete(
            wrangler,
            ["queues", "delete", resourceStagedName(resource)],
            rootDir,
          );
          break;
        case "hyperdrive": {
          const rid = resourceId(resource);
          if (rid) {
            wranglerWithIdempotentDelete(
              wrangler,
              ["hyperdrive", "delete", rid],
              rootDir,
            );
          }
          break;
        }
        case "vectorize":
          deleteVectorizeIndex(resourceStagedName(resource), rootDir);
          break;
        case "d1":
          deleteD1Database(resourceStagedName(resource), rootDir);
          break;
        case "r2":
          deleteR2Bucket(resourceStagedName(resource), rootDir);
          break;
      }

      delete state.resources[logicalName];
      destroyedResources.push(resourceStagedName(resource));
      await provider.write(stage, state);
      logger.log(`    deleted`);
    } catch (err) {
      hasFailures = true;
      logger.error(`    FAILED: ${(err as Error).message}`);
    }
  }

  // Only delete state if everything was cleaned up successfully.
  // Partial failures preserve state so the user can re-run destroy.
  if (hasFailures) {
    logger.log(`\n  Stage "${stage}" partially destroyed. State preserved — re-run to retry.\n`);
  } else {
    await provider.delete(stage);
    logger.log(`\n  Stage "${stage}" destroyed.\n`);
  }

  return {
    stage,
    detachedConsumers: detachedConsumerList,
    destroyedWorkers,
    destroyedResources,
    stateDeleted: !hasFailures,
    partialFailures: hasFailures,
  };
}
