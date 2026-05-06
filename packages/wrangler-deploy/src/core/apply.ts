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
import { classifyReplacement, describeReplacement } from "./replacement.js";
import { supportsAdopt, adoptUnsupportedMessage } from "./resource-capabilities.js";
import {
  applyD1Migrations as defaultApplyD1Migrations,
  createD1Database as defaultCreateD1,
  executeD1File as defaultExecuteD1File,
} from "../providers/d1.js";
import { createR2Bucket as defaultCreateR2 } from "../providers/r2.js";
import { createVectorizeIndex as defaultCreateVectorize } from "../providers/vectorize.js";
import {
  findZoneId as defaultFindZoneId,
  reconcileDnsRecords as defaultReconcileDns,
} from "../providers/dns.js";

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
      const newProps: ResourceProps = {
        type: resource.type,
        name: stagedName,
        bindings: resource.bindings as Record<string, unknown>,
        ...(resource.type === "vectorize"
          ? {
              ...(resource.dimensions !== undefined ? { dimensions: resource.dimensions } : {}),
              ...(resource.metric !== undefined ? { metric: resource.metric } : {}),
              ...(resource.preset !== undefined ? { preset: resource.preset } : {}),
            }
          : {}),
        ...(resource.type === "hyperdrive" && resource.database
          ? { database: resource.database }
          : {}),
      };
      const verdict = classifyReplacement(resource.type, stateResource.props, newProps);
      if (verdict.required) {
        items.push({
          resource: logicalName,
          type: resource.type,
          action: "drifted",
          name: resourceStagedName(stateResource),
          details: describeReplacement(verdict),
        });
      } else {
        items.push({
          resource: logicalName,
          type: resource.type,
          action: "in-sync",
          name: resourceStagedName(stateResource),
        });
      }
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
  /**
   * Re-run lifecycle for resources marked in-sync. Useful when a property
   * change was made out-of-band on Cloudflare and you want wrangler-deploy
   * to overwrite it back to the configured shape.
   */
  force?: boolean;
};

export type ApplyDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
  logger?: Pick<Console, "log" | "warn" | "error">;
  createD1?: typeof defaultCreateD1;
  applyD1Migrations?: typeof defaultApplyD1Migrations;
  executeD1File?: typeof defaultExecuteD1File;
  createR2?: typeof defaultCreateR2;
  createVectorize?: typeof defaultCreateVectorize;
  readConfig?: typeof defaultReadWranglerConfig;
  renderConfig?: typeof defaultRenderWranglerConfig;
  writeConfigs?: typeof defaultWriteRenderedConfigs;
  findZoneId?: typeof defaultFindZoneId;
  reconcileDns?: typeof defaultReconcileDns;
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

function wranglerWithIdempotency(
  runner: WranglerRunner,
  args: string[],
  cwd: string,
  options: { adopt?: boolean } = {},
): string {
  try {
    return runner.run(args, cwd);
  } catch (err: unknown) {
    const message = (err as Error).message || "";
    const isAlreadyExists =
      message.includes("already exists") ||
      message.includes("already taken") ||
      message.includes("11009") || // queue already exists
      message.includes("10014") || // kv namespace already exists
      message.includes("10026"); // kv namespace already exists (alt code)

    if (!isAlreadyExists) throw err;

    if (options.adopt === false) {
      throw new Error(
        `Resource already exists in Cloudflare and adopt: false is set. ` +
        `Pass adopt: true on this resource (or remove the flag) to take it under management.`,
        { cause: err },
      );
    }
    console.log(`    (already exists — adopting)`);
    return message;
  }
}

/**
 * Apply the manifest — provision resources via wrangler CLI, write state, generate configs.
 * Uses write-before-act pattern for crash recovery: writes "creating" before each provider
 * call and "created" after, so a resume after crash retries incomplete resources.
 */
export async function apply(args: ApplyArgs, deps: ApplyDeps): Promise<ApplyResult> {
  const { stage, databaseUrl, force = false } = args;
  const {
    rootDir,
    config,
    state: provider,
    wrangler,
    logger = console,
    createD1 = defaultCreateD1,
    applyD1Migrations = defaultApplyD1Migrations,
    executeD1File = defaultExecuteD1File,
    createR2 = defaultCreateR2,
    createVectorize = defaultCreateVectorize,
    readConfig = defaultReadWranglerConfig,
    renderConfig = defaultRenderWranglerConfig,
    writeConfigs = defaultWriteRenderedConfigs,
    findZoneId = defaultFindZoneId,
    reconcileDns = defaultReconcileDns,
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

    if (existing && isActive(existing) && !force) {
      logger.log(`  = ${stagedName} (${resource.type}) in sync`);
      // Migrations are idempotent (tracked in d1_migrations) and need to
      // run on every apply so newly added migration files get picked up
      // without forcing a re-create.
      if (resource.type === "d1") {
        const d1Config = resource as import("../types.js").D1ResourceConfig;
        if (d1Config.migrationsDir) {
          logger.log(`    applying migrations from ${d1Config.migrationsDir}`);
          applyD1Migrations({
            name: stagedName,
            migrationsDir: resolve(rootDir, d1Config.migrationsDir),
            migrationsTable: d1Config.migrationsTable,
            remote: true,
            cwd: rootDir,
          });
        }
      }
      resourceSummaries.push({
        logicalName,
        type: resource.type,
        stagedName,
        lifecycleStatus: "in-sync",
        id: resourceId(existing),
      });
      continue;
    }
    if (existing && isActive(existing) && force) {
      logger.log(`  ~ ${stagedName} (${resource.type}) re-applying (--force)`);
    }

    logger.log(`  + creating ${stagedName} (${resource.type})...`);

    try {
      if (resource.adopt !== undefined && !supportsAdopt(resource.type)) {
        throw new Error(
          `${adoptUnsupportedMessage(resource.type)} Remove adopt from "${logicalName}" or use a supported resource type.`,
        );
      }
      // Build props snapshot — common fields plus type-specific extras
      const props: ResourceProps = {
        type: resource.type,
        name: stagedName,
        bindings: resource.bindings as Record<string, unknown>,
        ...(resource.adopt !== undefined ? { adopt: resource.adopt } : {}),
        ...(resource.delete === false ? { delete: false } : {}),
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
        lifecycle: resource.adopt !== undefined
          ? { adoptRequested: resource.adopt, adoptSupported: supportsAdopt(resource.type) }
          : undefined,
        props,
        ...(existing ? { oldProps: existing.props } : {}),
        source: "managed",
      };
      await provider.write(stage, state);

      let resourceOutput: ResourceOutput | undefined;
      const adopt = resource.adopt;

      switch (resource.type) {
        case "kv": {
          const output = wranglerWithIdempotency(
            wrangler,
            ["kv", "namespace", "create", stagedName],
            rootDir,
            { adopt },
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
            { adopt },
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
            { adopt },
          );
          const id = extractId(output);
          resourceOutput = { id: id!, name: stagedName, origin: databaseUrl };
          break;
        }
        case "d1": {
          const d1Config = resource as import("../types.js").D1ResourceConfig;
          resourceOutput = createD1(stagedName, rootDir);

          // Imports run only on fresh creates — these are bootstrap data,
          // not migrations.
          if (d1Config.importFiles && !existing) {
            for (const file of d1Config.importFiles) {
              const filePath = resolve(rootDir, file);
              logger.log(`    importing ${file}`);
              executeD1File({ name: stagedName, file: filePath, remote: true, cwd: rootDir });
            }
          }
          if (d1Config.migrationsDir) {
            logger.log(`    applying migrations from ${d1Config.migrationsDir}`);
            applyD1Migrations({
              name: stagedName,
              migrationsDir: resolve(rootDir, d1Config.migrationsDir),
              migrationsTable: d1Config.migrationsTable,
              remote: true,
              cwd: rootDir,
            });
          }
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
        case "dns": {
          const dnsConfig = resource as import("../types.js").DnsResourceConfig;
          const apiToken = process.env.CLOUDFLARE_API_TOKEN;
          if (!apiToken) {
            throw new Error("CLOUDFLARE_API_TOKEN is required to manage DNS records");
          }
          const desired = dnsConfig.records.map((record) => ({
            ...record,
            name: record.name.replace(/\{stage\}/g, stage),
          }));
          const zoneId = await findZoneId(dnsConfig.zone, { apiToken });
          const records = await reconcileDns(zoneId, desired, { apiToken });
          resourceOutput = {
            zoneId,
            records: records.map((r) => ({
              id: r.id,
              name: r.name,
              type: r.type,
              content: r.content,
            })),
          };
          break;
        }
      }

      // Write "created" status after provider succeeds (clears oldProps)
      state.resources[logicalName] = {
        type: resource.type,
        lifecycleStatus: existing ? "updated" : "created",
        lifecycle: state.resources[logicalName]!.lifecycle,
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
