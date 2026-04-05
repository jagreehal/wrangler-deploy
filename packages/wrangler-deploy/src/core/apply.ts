import { resolve } from "node:path";
import type { CfStageConfig, StageState, WranglerConfig, PlanItem, Plan, VectorizeResourceConfig } from "../types.js";
import { resourceName, workerName } from "./naming.js";
import type { StateProvider } from "./state.js";
import { readWranglerConfig as defaultReadWranglerConfig } from "./wrangler.js";
import {
  renderWranglerConfig as defaultRenderWranglerConfig,
  writeRenderedConfigs as defaultWriteRenderedConfigs,
} from "./render.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { createD1Database as defaultCreateD1 } from "../providers/d1.js";
import { createR2Bucket as defaultCreateR2 } from "../providers/r2.js";
import { createVectorizeIndex as defaultCreateVectorize } from "../providers/vectorize.js";

// ============================================================================
// plan()
// ============================================================================

export type PlanArgs = {
  stage: string;
};

export type PlanDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
};

/**
 * Compute a plan: what resources need to be created, are in sync, drifted, or orphaned.
 */
export async function plan(args: PlanArgs, deps: PlanDeps): Promise<Plan> {
  const { stage } = args;
  const { config, state: provider } = deps;
  const state = await provider.read(stage);
  const items: PlanItem[] = [];

  for (const [logicalName, resource] of Object.entries(config.resources)) {
    const stagedName = resourceName(logicalName, stage);
    const stateResource = state?.resources[logicalName];

    if (!stateResource) {
      items.push({
        resource: logicalName,
        type: resource.type,
        action: "create",
        name: stagedName,
      });
    } else if (stateResource.observed.status === "active") {
      items.push({
        resource: logicalName,
        type: resource.type,
        action: "in-sync",
        name: stateResource.desired.name,
      });
    } else {
      // Map state status to a valid PlanAction.
      // "missing" means the resource was tracked but no longer exists live — treat as orphaned.
      const status = stateResource.observed.status;
      const action = status === "missing" ? "orphaned" : status as "drifted" | "orphaned";
      items.push({
        resource: logicalName,
        type: resource.type,
        action,
        name: stateResource.desired.name,
      });
    }
  }

  // Check for orphans — resources in state but not in manifest
  if (state) {
    for (const [logicalName, stateResource] of Object.entries(state.resources)) {
      if (!(logicalName in config.resources)) {
        items.push({
          resource: logicalName,
          type: stateResource.type,
          action: "orphaned",
          name: stateResource.desired.name,
          details: "In state but removed from manifest",
        });
      }
    }
  }

  return { stage, items };
}

// ============================================================================
// apply()
// ============================================================================

export type ApplyArgs = {
  stage: string;
  databaseUrl?: string;
};

export type ApplyDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
  createD1?: typeof defaultCreateD1;
  createR2?: typeof defaultCreateR2;
  createVectorize?: typeof defaultCreateVectorize;
  readConfig?: typeof defaultReadWranglerConfig;
  renderConfig?: typeof defaultRenderWranglerConfig;
  writeConfigs?: typeof defaultWriteRenderedConfigs;
};

function extractId(output: string): string | undefined {
  // Try various patterns wrangler outputs IDs in
  const patterns = [
    /"id"\s*:\s*"([a-f0-9-]{32,36})"/,
    /id\s*[:=]\s*"?([a-f0-9-]{32,36})"?/i,
    /\b([a-f0-9]{32})\b/,
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function wranglerWithIdempotency(runner: WranglerRunner, args: string[], cwd: string): string {
  try {
    return runner.run(args, cwd);
  } catch (err: unknown) {
    const message = (err as Error).message || "";
    // Idempotent — treat "already exists" as success
    if (
      message.includes("already exists") ||
      message.includes("already taken") ||
      message.includes("11009") || // queue already exists
      message.includes("10014") || // kv namespace already exists
      message.includes("10026") // kv namespace already exists (alt code)
    ) {
      console.log(`    (already exists — adopting)`);
      return message;
    }
    throw err;
  }
}

/**
 * Apply the manifest — provision resources via wrangler CLI, write state, generate configs.
 * Uses wrangler for auth (supports OAuth login, no API token needed).
 */
export async function apply(args: ApplyArgs, deps: ApplyDeps): Promise<StageState> {
  const { stage, databaseUrl } = args;
  const {
    rootDir,
    config,
    state: provider,
    wrangler,
    createD1 = defaultCreateD1,
    createR2 = defaultCreateR2,
    createVectorize = defaultCreateVectorize,
    readConfig = defaultReadWranglerConfig,
    renderConfig = defaultRenderWranglerConfig,
    writeConfigs = defaultWriteRenderedConfigs,
  } = deps;

  // Load or create state (from remote if using provider)
  const remoteState = await provider.read(stage);
  const state = remoteState ?? {
    stage,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resources: {},
    workers: {},
    secrets: {},
  };

  console.log(`\n  wrangler-deploy apply --stage ${stage}\n`);

  // Provision resources
  for (const [logicalName, resource] of Object.entries(config.resources)) {
    const stagedName = resourceName(logicalName, stage);
    const existing = state.resources[logicalName];

    if (existing?.observed.status === "active") {
      console.log(`  = ${stagedName} (${resource.type}) in sync`);
      continue;
    }

    console.log(`  + creating ${stagedName} (${resource.type})...`);

    try {
      let id: string | undefined;

      switch (resource.type) {
        case "kv": {
          const output = wranglerWithIdempotency(
            wrangler,
            ["kv", "namespace", "create", stagedName],
            rootDir,
          );
          id = extractId(output);
          // If "already exists" didn't give us an ID, look it up
          if (!id) {
            const listOutput = wrangler.run(["kv", "namespace", "list"], rootDir);
            const match = listOutput.match(
              new RegExp(
                `"id"\\s*:\\s*"([a-f0-9]{32})"[^}]*"title"\\s*:\\s*"${stagedName}"|"title"\\s*:\\s*"${stagedName}"[^}]*"id"\\s*:\\s*"([a-f0-9]{32})"`,
              ),
            );
            id = match?.[1] ?? match?.[2];
          }
          break;
        }
        case "queue": {
          const output = wranglerWithIdempotency(
            wrangler,
            ["queues", "create", stagedName],
            rootDir,
          );
          id = extractId(output);
          // If "already exists" didn't give us an ID, look it up
          if (!id) {
            const listOutput = wrangler.run(["queues", "list"], rootDir);
            const match = listOutput.match(
              new RegExp(
                `"queue_id"\\s*:\\s*"([a-f0-9-]{36})"[^}]*"queue_name"\\s*:\\s*"${stagedName}"|"queue_name"\\s*:\\s*"${stagedName}"[^}]*"queue_id"\\s*:\\s*"([a-f0-9-]{36})"`,
              ),
            );
            id = match?.[1] ?? match?.[2];
          }
          break;
        }
        case "hyperdrive": {
          if (!databaseUrl) {
            throw new Error(
              `--database-url is required to create Hyperdrive config "${logicalName}"`,
            );
          }
          const output = wranglerWithIdempotency(
            wrangler,
            ["hyperdrive", "create", stagedName, "--database-url", databaseUrl],
            rootDir,
          );
          id = extractId(output);
          break;
        }
        case "d1": {
          id = createD1(stagedName, rootDir);
          break;
        }
        case "r2": {
          createR2(stagedName, rootDir);
          break;
        }
        case "vectorize": {
          const vectorizeConfig = resource as VectorizeResourceConfig;
          id = createVectorize(
            stagedName,
            {
              dimensions: vectorizeConfig.dimensions,
              metric: vectorizeConfig.metric,
              preset: vectorizeConfig.preset,
              description: vectorizeConfig.description,
            },
            rootDir,
          );
          break;
        }
      }

      // Update state immediately after each resource
      state.resources[logicalName] = {
        type: resource.type,
        desired: { name: stagedName },
        observed: {
          id,
          status: "active",
          lastSeenAt: new Date().toISOString(),
        },
        source: "managed",
      };
      state.updatedAt = new Date().toISOString();
      await provider.write(stage, state);

      console.log(`    created${id ? ` (id: ${id})` : ""}`);
    } catch (err) {
      console.error(`    FAILED: ${(err as Error).message}`);
      throw err;
    }
  }

  // Record worker names in state and remove stale workers no longer in config
  const declaredWorkers = new Set(config.workers);
  for (const workerPath of config.workers) {
    const wranglerConfig = readConfig(resolve(rootDir, workerPath));
    state.workers[workerPath] = {
      name: workerName(wranglerConfig.name, stage),
    };
  }
  for (const workerPath of Object.keys(state.workers)) {
    if (!declaredWorkers.has(workerPath)) {
      delete state.workers[workerPath];
    }
  }
  state.updatedAt = new Date().toISOString();
  await provider.write(stage, state);

  // Generate rendered wrangler configs
  const renderedConfigs = new Map<string, WranglerConfig>();
  for (const workerPath of config.workers) {
    const baseConfig = readConfig(resolve(rootDir, workerPath));
    const rendered = renderConfig(baseConfig, workerPath, config, state, stage, rootDir);
    renderedConfigs.set(workerPath, rendered);
  }
  writeConfigs(rootDir, stage, renderedConfigs);

  console.log(
    `\n  State written to ${config.state?.backend === "kv" ? "KV" : ".wrangler-deploy"}/${stage}/state.json`,
  );
  console.log(`  Rendered configs written for ${config.workers.length} workers\n`);

  return state;
}
