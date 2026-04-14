import type { StageState, ResourceState } from "../types.js";
import { resourceId, resourceStagedName } from "../types.js";
import type { WranglerRunner } from "./wrangler-runner.js";

export type DriftStatus = "in-sync" | "drifted" | "orphaned" | "missing";

export interface DriftResult {
  resource: string;
  type: string;
  status: DriftStatus;
  details?: string;
}

export type DetectDriftArgs = {
  state: StageState;
};

export type DetectDriftDeps = {
  rootDir: string;
  wrangler: WranglerRunner;
};

function wranglerList(runner: WranglerRunner, args: string[], cwd: string): string {
  try {
    return runner.run(args, cwd);
  } catch {
    return "";
  }
}

function parseJsonArray(output: string): unknown[] {
  const start = output.indexOf("[");
  if (start === -1) return [];
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return [];
  }
}

/**
 * Check if a KV namespace still exists and has the expected title.
 */
function checkKv(resource: ResourceState, runner: WranglerRunner, cwd: string): DriftStatus {
  const rid = resourceId(resource);
  if (!rid) return "missing";
  const output = wranglerList(runner, ["kv", "namespace", "list"], cwd);
  const namespaces = parseJsonArray(output) as Array<{ id: string; title: string }>;
  const match = namespaces.find((ns) => ns.id === rid);
  if (!match) return "orphaned";
  if (match.title === resourceStagedName(resource)) return "in-sync";
  return "drifted";
}

/**
 * Check if a queue still exists with the expected name.
 */
function checkQueue(resource: ResourceState, runner: WranglerRunner, cwd: string): DriftStatus {
  const output = wranglerList(runner, ["queues", "list"], cwd);
  const queues = parseJsonArray(output) as Array<{ queue_name: string }>;
  if (queues.some((q) => q.queue_name === resourceStagedName(resource))) return "in-sync";
  return "orphaned";
}

/**
 * Check if a Hyperdrive config still exists.
 */
function checkHyperdrive(resource: ResourceState, runner: WranglerRunner, cwd: string): DriftStatus {
  const rid = resourceId(resource);
  if (!rid) return "missing";
  const output = wranglerList(runner, ["hyperdrive", "list"], cwd);
  const configs = parseJsonArray(output) as Array<{ id: string }>;
  if (configs.some((c) => c.id === rid)) return "in-sync";
  return "orphaned";
}

/**
 * Check if a D1 database still exists with the expected name.
 */
function checkD1(resource: ResourceState, runner: WranglerRunner, cwd: string): DriftStatus {
  const output = wranglerList(runner, ["d1", "list", "--json"], cwd);
  const databases = parseJsonArray(output) as Array<{ name: string }>;
  if (databases.some((db) => db.name === resourceStagedName(resource))) return "in-sync";
  return "orphaned";
}

/**
 * Check if an R2 bucket still exists with the expected name.
 */
function checkR2(resource: ResourceState, runner: WranglerRunner, cwd: string): DriftStatus {
  const output = wranglerList(runner, ["r2", "bucket", "list"], cwd);
  const buckets = parseJsonArray(output) as Array<{ name: string }>;
  if (buckets.some((b) => b.name === resourceStagedName(resource))) return "in-sync";
  return "orphaned";
}

/**
 * Check if a Vectorize index still exists with the expected name.
 */
function checkVectorize(resource: ResourceState, runner: WranglerRunner, cwd: string): DriftStatus {
  const output = wranglerList(runner, ["vectorize", "list"], cwd);
  const indexes = parseJsonArray(output) as Array<{ name: string }>;
  if (indexes.some((v) => v.name === resourceStagedName(resource))) return "in-sync";
  return "orphaned";
}

/**
 * Detect drift for all resources in a stage's state.
 */
export function detectDrift(args: DetectDriftArgs, deps: DetectDriftDeps): DriftResult[] {
  const { state } = args;
  const { rootDir, wrangler } = deps;
  const results: DriftResult[] = [];

  for (const [name, resource] of Object.entries(state.resources)) {
    let status: DriftStatus;

    switch (resource.type) {
      case "kv":
        status = checkKv(resource, wrangler, rootDir);
        break;
      case "queue":
        status = checkQueue(resource, wrangler, rootDir);
        break;
      case "hyperdrive":
        status = checkHyperdrive(resource, wrangler, rootDir);
        break;
      case "d1":
        status = checkD1(resource, wrangler, rootDir);
        break;
      case "r2":
        status = checkR2(resource, wrangler, rootDir);
        break;
      case "vectorize":
        status = checkVectorize(resource, wrangler, rootDir);
        break;
      default:
        status = "in-sync";
    }

    results.push({
      resource: name,
      type: resource.type,
      status,
      details: status !== "in-sync" ? `Expected: ${resourceStagedName(resource)}` : undefined,
    });
  }

  return results;
}
