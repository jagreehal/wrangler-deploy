import { resolve } from "node:path";
import type {
  CfStageConfig,
  StageState,
  WranglerConfig,
  PlanItem,
  Plan,
  VectorizeResourceConfig,
  HyperdriveResourceConfig,
  ResourceOutput,
  ResourceProps,
} from "../types.js";
import { isActive, resourceId, resourceStagedName } from "../types.js";
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
    } else if (isActive(stateResource)) {
      items.push({
        resource: logicalName,
        type: resource.type,
        action: "in-sync",
        name: resourceStagedName(stateResource),
      });
    } else {
      const ls = stateResource.lifecycleStatus;
      const action = ls === "missing" ? "orphaned" : ls as "drifted" | "orphaned";
      items.push({
        resource: logicalName,
        type: resource.type,
        action,
        name: resourceStagedName(stateResource),
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
          name: resourceStagedName(stateResource),
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
  logger?: Pick<Console, "log" | "warn" | "error">;
  createD1?: typeof defaultCreateD1;
  createR2?: typeof defaultCreateR2;
  createVectorize?: typeof defaultCreateVectorize;
  readConfig?: typeof defaultReadWranglerConfig;
  renderConfig?: typeof defaultRenderWranglerConfig;
  writeConfigs?: typeof defaultWriteRenderedConfigs;
};

export interface ApplyResourceSummary {
  logicalName: string;
  type: string;
  stagedName: string;
  lifecycleStatus: "creating" | "updating" | "created" | "updated" | "in-sync";
  id?: string;
}

export interface ApplyResult extends StageState {
  summary: {
    stage: string;
    resources: ApplyResourceSummary[];
    workers: string[];
    renderedConfigs: string[];
    storedSecrets: string[];
  };
}

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
 * Uses write-before-act pattern for crash recovery: writes "creating" before each provider
 * call and "created" after, so a resume after crash retries incomplete resources.
 */
export async function apply(args: ApplyArgs, deps: ApplyDeps): Promise<ApplyResult> {
  const { stage, databaseUrl } = args;
  const {
    rootDir,
    config,
    state: provider,
    wrangler,
    logger = console,
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

  const resourceSummaries: ApplyResourceSummary[] = [];

  // Provision resources
  for (const [logicalName, resource] of Object.entries(config.resources)) {
    const stagedName = resourceName(logicalName, stage);
    const existing = state.resources[logicalName];

    if (existing && isActive(existing)) {
      logger.log(`  = ${stagedName} (${resource.type}) in sync`);
      resourceSummaries.push({
        logicalName,
        type: resource.type,
        stagedName,
        lifecycleStatus: "in-sync",
        id: resourceId(existing),
      });
      continue;
    }

    logger.log(`  + creating ${stagedName} (${resource.type})...`);

    try {
      // Build props snapshot — common fields plus type-specific extras
      const props: ResourceProps = {
        type: resource.type,
        name: stagedName,
        bindings: resource.bindings as Record<string, unknown>,
      };
      if (resource.type === "vectorize") {
        const vr = resource as VectorizeResourceConfig;
        if (vr.dimensions !== undefined) props["dimensions"] = vr.dimensions;
        if (vr.metric !== undefined) props["metric"] = vr.metric;
        if (vr.preset !== undefined) props["preset"] = vr.preset;
        if (vr.description !== undefined) props["description"] = vr.description;
      }
      if (resource.type === "hyperdrive") {
        const hr = resource as HyperdriveResourceConfig;
        if (hr.database) props["database"] = hr.database;
      }

      // Write-before-act: persist "creating" status before calling provider (crash recovery anchor)
      state.resources[logicalName] = {
        type: resource.type,
        lifecycleStatus: existing ? "updating" : "creating",
        props,
        ...(existing ? { oldProps: existing.props } : {}),
        source: "managed",
      };
      await provider.write(stage, state);

      let resourceOutput: ResourceOutput | undefined;

      switch (resource.type) {
        case "kv": {
          const output = wranglerWithIdempotency(
            wrangler,
            ["kv", "namespace", "create", stagedName],
            rootDir,
          );
          let id = extractId(output);
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
          resourceOutput = { id: id!, title: stagedName };
          break;
        }
        case "queue": {
          const output = wranglerWithIdempotency(
            wrangler,
            ["queues", "create", stagedName],
            rootDir,
          );
          let id = extractId(output);
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
          resourceOutput = { id: id ?? undefined, name: stagedName };
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
          const id = extractId(output);
          resourceOutput = { id: id!, name: stagedName, origin: databaseUrl };
          break;
        }
        case "d1": {
          resourceOutput = createD1(stagedName, rootDir);
          break;
        }
        case "r2": {
          resourceOutput = createR2(stagedName, rootDir);
          break;
        }
        case "vectorize": {
          const vectorizeConfig = resource as VectorizeResourceConfig;
          resourceOutput = createVectorize(
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

      // Write "created" status after provider succeeds (clears oldProps)
      state.resources[logicalName] = {
        type: resource.type,
        lifecycleStatus: existing ? "updated" : "created",
        props: state.resources[logicalName]!.props,
        output: resourceOutput,
        source: "managed",
      };
      state.updatedAt = new Date().toISOString();
      await provider.write(stage, state);

      const id = resourceOutput ? resourceId(state.resources[logicalName]!) : undefined;
      logger.log(`    created${id ? ` (id: ${id})` : ""}`);
      resourceSummaries.push({
        logicalName,
        type: resource.type,
        stagedName,
        lifecycleStatus: existing ? "updated" : "created",
        id,
      });
    } catch (err) {
      logger.error(`    FAILED: ${(err as Error).message}`);
      throw err;
    }
  }

  const renderedWorkers = config.workers.slice();

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

  // Store encrypted secrets from config (encryption handled by state provider on write)
  if (config.storedSecrets && Object.keys(config.storedSecrets).length > 0) {
    state.storedSecrets = { ...config.storedSecrets };
    if (!config.statePassword && !process.env.WD_STATE_PASSWORD) {
      logger.warn("  Warning: storedSecrets are present but no statePassword is set — storing as plaintext");
    }
  }

  await provider.write(stage, state);

  // Generate rendered wrangler configs
  const renderedConfigs = new Map<string, WranglerConfig>();
  for (const workerPath of config.workers) {
    const baseConfig = readConfig(resolve(rootDir, workerPath));
    const rendered = renderConfig(baseConfig, workerPath, config, state, stage, rootDir);
    renderedConfigs.set(workerPath, rendered);
  }
  writeConfigs(rootDir, stage, renderedConfigs);

  logger.log(
    `\n  State written to ${config.state?.backend === "kv" ? "KV" : ".wrangler-deploy"}/${stage}/state.json`,
  );
  logger.log(`  Rendered configs written for ${config.workers.length} workers\n`);

  // Callers may call enrichMarkers(markers, state) to attach output to typed markers.
  // See src/core/enrich.ts.
  return Object.assign(state, {
    summary: {
      stage,
      resources: resourceSummaries,
      workers: renderedWorkers,
      renderedConfigs: renderedWorkers.map((workerPath) => resolve(rootDir, ".wrangler-deploy", stage, workerPath, "wrangler.rendered.jsonc")),
      storedSecrets: config.storedSecrets ? Object.keys(config.storedSecrets).flatMap((workerPath) => Object.keys(config.storedSecrets?.[workerPath] ?? {}).map((secret) => `${workerPath}/${secret}`)) : [],
    },
  }) as ApplyResult;
}
