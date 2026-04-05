import type { CfStageConfig } from "../types.js";
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
};

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

export async function destroy(args: DestroyArgs, deps: DestroyDeps): Promise<void> {
  const { stage, force } = args;
  const { rootDir, config, state: provider, wrangler } = deps;

  if (isStageProtected(stage, config.stages) && !force) {
    throw new Error(`Stage "${stage}" is protected. Use --force to destroy it.`);
  }

  const state = await provider.read(stage);
  if (!state) {
    console.log(`  No state found for stage "${stage}". Nothing to destroy.`);
    return;
  }

  console.log(`\n  wrangler-deploy destroy --stage ${stage}\n`);

  // Track whether any deletion fails — if so, preserve state for recovery
  let hasFailures = false;

  // First: remove queue consumers (must happen before worker deletion).
  // Walk config.resources for known consumer bindings.
  const detachedConsumers = new Set<string>(); // "queueName:workerName" pairs already handled
  for (const [logicalName, resource] of Object.entries(config.resources)) {
    if (resource.type !== "queue") continue;
    for (const [workerPath, binding] of Object.entries(resource.bindings)) {
      if (typeof binding === "object" && "consumer" in binding) {
        const workerState = state.workers[workerPath];
        if (!workerState) continue;
        const queueName = state.resources[logicalName]?.desired.name;
        if (!queueName) continue;
        detachedConsumers.add(`${queueName}:${workerState.name}`);
        console.log(`  - removing queue consumer ${workerState.name} from ${queueName}...`);
        try {
          wranglerWithIdempotentDelete(
            wrangler,
            ["queues", "consumer", "remove", queueName, workerState.name],
            rootDir,
          );
          console.log(`    removed`);
        } catch (err) {
          hasFailures = true;
          console.error(`    FAILED: ${(err as Error).message}`);
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
    const queueName = resource.desired.name;
    for (const [, workerState] of Object.entries(state.workers)) {
      const key = `${queueName}:${workerState.name}`;
      if (detachedConsumers.has(key)) continue;
      detachedConsumers.add(key);
      console.log(`  - removing queue consumer ${workerState.name} from ${queueName}...`);
      try {
        wranglerWithIdempotentDelete(
          wrangler,
          ["queues", "consumer", "remove", queueName, workerState.name],
          rootDir,
        );
        console.log(`    removed`);
      } catch (err) {
        hasFailures = true;
        console.error(`    FAILED: ${(err as Error).message}`);
      }
    }
  }

  // Delete workers (reverse deploy order for config-known workers first)
  const reverseDeployOrder = [...resolveDeployOrder(config)].reverse();
  for (const workerPath of reverseDeployOrder) {
    const workerState = state.workers[workerPath];
    if (!workerState) continue;

    console.log(`  - deleting worker ${workerState.name}...`);
    try {
      wranglerWithIdempotentDelete(
        wrangler,
        ["delete", "--name", workerState.name, "--force"],
        rootDir,
      );
      delete state.workers[workerPath];
      await provider.write(stage, state);
      console.log(`    deleted`);
    } catch (err) {
      hasFailures = true;
      console.error(`    FAILED: ${(err as Error).message}`);
    }
  }

  // Delete orphaned workers still in state but no longer in config
  for (const [workerPath, workerState] of Object.entries(state.workers)) {
    console.log(`  - deleting orphaned worker ${workerState.name}...`);
    try {
      wranglerWithIdempotentDelete(
        wrangler,
        ["delete", "--name", workerState.name, "--force"],
        rootDir,
      );
      delete state.workers[workerPath];
      await provider.write(stage, state);
      console.log(`    deleted`);
    } catch (err) {
      hasFailures = true;
      console.error(`    FAILED: ${(err as Error).message}`);
    }
  }

  // Delete resources in reverse order
  const resourceNames = Object.keys(state.resources).reverse();
  for (const logicalName of resourceNames) {
    const resource = state.resources[logicalName];
    if (!resource) continue;
    if (resource.source !== "managed") continue;

    console.log(`  - deleting ${resource.desired.name} (${resource.type})...`);

    try {
      switch (resource.type) {
        case "kv":
          if (resource.observed.id) {
            wranglerWithIdempotentDelete(
              wrangler,
              ["kv", "namespace", "delete", "--namespace-id", resource.observed.id],
              rootDir,
            );
          }
          break;
        case "queue":
          wranglerWithIdempotentDelete(
            wrangler,
            ["queues", "delete", resource.desired.name],
            rootDir,
          );
          break;
        case "hyperdrive":
          if (resource.observed.id) {
            wranglerWithIdempotentDelete(
              wrangler,
              ["hyperdrive", "delete", resource.observed.id],
              rootDir,
            );
          }
          break;
        case "vectorize":
          deleteVectorizeIndex(resource.desired.name, rootDir);
          break;
        case "d1":
          deleteD1Database(resource.desired.name, rootDir);
          break;
        case "r2":
          deleteR2Bucket(resource.desired.name, rootDir);
          break;
      }

      delete state.resources[logicalName];
      await provider.write(stage, state);
      console.log(`    deleted`);
    } catch (err) {
      hasFailures = true;
      console.error(`    FAILED: ${(err as Error).message}`);
    }
  }

  // Only delete state if everything was cleaned up successfully.
  // Partial failures preserve state so the user can re-run destroy.
  if (hasFailures) {
    console.log(`\n  Stage "${stage}" partially destroyed. State preserved — re-run to retry.\n`);
  } else {
    await provider.delete(stage);
    console.log(`\n  Stage "${stage}" destroyed.\n`);
  }
}
