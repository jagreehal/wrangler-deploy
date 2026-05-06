import type { CfStageConfig, StageState } from "../types.js";
import { resourceId, resourceStagedName } from "../types.js";

/**
 * Read-side helpers for `wd state list/get/tree`. Pure functions over a
 * StageState snapshot — they do not touch the network or filesystem.
 *
 * Renderers return strings rather than printing so the CLI layer can
 * decide between human and JSON output.
 */

export interface StateListEntry {
  resource: string;
  type: string;
  status: string;
  id?: string;
  stagedName: string;
}

export function buildStateList(state: StageState): StateListEntry[] {
  return Object.entries(state.resources)
    .map(([logicalName, resource]) => ({
      resource: logicalName,
      type: resource.type,
      status: resource.lifecycleStatus,
      id: resourceId(resource),
      stagedName: resourceStagedName(resource),
    }))
    .sort((a, b) => a.resource.localeCompare(b.resource));
}

export function renderStateListText(state: StageState): string {
  const rows = buildStateList(state);
  if (rows.length === 0) {
    return `\n  no resources in state for stage "${state.stage}"\n`;
  }
  const lines: string[] = [];
  lines.push("");
  lines.push(`  wrangler-deploy state list --stage ${state.stage}`);
  lines.push("");
  const widthName = Math.max(8, ...rows.map((r) => r.resource.length));
  const widthType = Math.max(4, ...rows.map((r) => r.type.length));
  lines.push(`  ${"NAME".padEnd(widthName)}  ${"TYPE".padEnd(widthType)}  STATUS    ID`);
  for (const row of rows) {
    lines.push(
      `  ${row.resource.padEnd(widthName)}  ${row.type.padEnd(widthType)}  ${row.status.padEnd(8)}  ${row.id ?? "(unknown)"}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export interface StateGetResult {
  resource: string;
  type: string;
  status: string;
  lifecycle?: unknown;
  stagedName: string;
  id?: string;
  output?: unknown;
  props?: unknown;
}

export function getStateEntry(
  state: StageState,
  resourceName: string,
): StateGetResult | undefined {
  const resource = state.resources[resourceName];
  if (!resource) return undefined;
  return {
    resource: resourceName,
    type: resource.type,
    status: resource.lifecycleStatus,
    lifecycle: resource.lifecycle,
    stagedName: resourceStagedName(resource),
    id: resourceId(resource),
    output: resource.output,
    props: resource.props,
  };
}

export function renderStateGetText(entry: StateGetResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${entry.resource}  (${entry.type})`);
  lines.push(`    status:      ${entry.status}`);
  if (entry.lifecycle !== undefined) {
    lines.push(`    lifecycle:`);
    for (const line of JSON.stringify(entry.lifecycle, null, 2).split("\n")) {
      lines.push(`      ${line}`);
    }
  }
  lines.push(`    staged name: ${entry.stagedName}`);
  if (entry.id) lines.push(`    id:          ${entry.id}`);
  if (entry.output !== undefined) {
    lines.push(`    output:`);
    for (const line of JSON.stringify(entry.output, null, 2).split("\n")) {
      lines.push(`      ${line}`);
    }
  }
  if (entry.props !== undefined) {
    lines.push(`    props:`);
    for (const line of JSON.stringify(entry.props, null, 2).split("\n")) {
      lines.push(`      ${line}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export interface TreeNode {
  label: string;
  detail?: string;
  children: TreeNode[];
}

/**
 * Build a tree rooted at workers, with each worker's bindings (resource and
 * service-binding) as children. Works best when given both the live state
 * (for resolved IDs and deploy status) and the source config (for bindings
 * the state hasn't seen yet, e.g. a worker that has not been deployed).
 */
export function buildStateTree(
  state: StageState,
  config?: CfStageConfig,
): TreeNode {
  const root: TreeNode = {
    label: `stage: ${state.stage}`,
    children: [],
  };

  const workerNames = new Set<string>([
    ...Object.keys(state.workers),
    ...(config?.workers ?? []),
  ]);

  for (const workerName of [...workerNames].sort()) {
    const workerState = state.workers[workerName];
    const node: TreeNode = {
      label: workerName,
      detail: workerState
        ? `${workerState.deployed ? "deployed" : "pending"}${workerState.url ? ` ${workerState.url}` : ""}`
        : "not deployed",
      children: [],
    };

    if (config) {
      for (const [resourceName, resourceConfig] of Object.entries(config.resources)) {
        const binding = resourceConfig.bindings?.[workerName];
        if (!binding) continue;
        const resourceState = state.resources[resourceName];
        const id = resourceState ? resourceId(resourceState) : undefined;
        node.children.push({
          label: `${typeof binding === "string" ? binding : describeBinding(binding)}`,
          detail: `${resourceConfig.type} → ${resourceName}${id ? ` (${id})` : ""}${renderLifecycleHint(state, resourceName)}`,
          children: [],
        });
      }
      const serviceBindings = config.serviceBindings?.[workerName];
      if (serviceBindings) {
        for (const [bindingName, target] of Object.entries(serviceBindings)) {
          node.children.push({
            label: bindingName,
            detail: `service → ${target}`,
            children: [],
          });
        }
      }
    }

    root.children.push(node);
  }

  for (const [resourceName, resource] of Object.entries(state.resources)) {
    const referenced = root.children.some((worker) =>
      worker.children.some((binding) =>
        (binding.detail ?? "").includes(`→ ${resourceName}`),
      ),
    );
    if (referenced) continue;
    root.children.push({
      label: resourceName,
      detail: `${resource.type} (unbound, ${resource.lifecycleStatus})${renderLifecycleHint(state, resourceName)}`,
      children: [],
    });
  }

  return root;
}

function describeBinding(binding: unknown): string {
  if (typeof binding === "string") return binding;
  if (binding && typeof binding === "object") {
    const keys = Object.keys(binding as Record<string, unknown>);
    if (keys.length > 0) return keys.join("+");
  }
  return "";
}

function renderLifecycleHint(state: StageState, resourceName: string): string {
  const lifecycle = state.resources[resourceName]?.lifecycle;
  if (!lifecycle || lifecycle.adoptRequested === undefined) return "";
  const requested = lifecycle.adoptRequested ? "true" : "false";
  const supported = lifecycle.adoptSupported === true ? "supported" : "unsupported";
  return ` [adopt:${requested}, ${supported}]`;
}

export function renderTreeAscii(tree: TreeNode): string {
  const lines: string[] = [];
  walk(tree, "", true, true, lines);
  return `\n${lines.join("\n")}\n`;
}

function walk(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  lines: string[],
): void {
  if (isRoot) {
    lines.push(`  ${node.label}${node.detail ? `  (${node.detail})` : ""}`);
  } else {
    const branch = isLast ? "└── " : "├── ";
    lines.push(`  ${prefix}${branch}${node.label}${node.detail ? `  ${node.detail}` : ""}`);
  }
  const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
  node.children.forEach((child, index) => {
    walk(child, childPrefix, index === node.children.length - 1, false, lines);
  });
}
