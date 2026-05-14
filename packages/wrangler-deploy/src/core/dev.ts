import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { spawn } from "node:child_process";
import type { CfStageConfig, DevCompanionConfig, ResourceType } from "../types.js";
import type { StateProvider } from "./state.js";
import { resolveDeployOrder } from "./graph.js";
import { assignPorts } from "./dev-ports.js";
import { createLogMultiplexer } from "./dev-logs.js";
import { findAvailablePorts } from "./port-finder.js";
import { readWranglerConfig } from "./wrangler.js";
import { renderWranglerConfig } from "./render.js";
import { AgentErrors } from "./cli-output.js";

export interface WorkerDevPlan {
  workerPath: string;
  cwd: string;
  configPath: string;
  port: number;
  args: string[];
  /** Env-var-name → deployed worker name (or null = missing from state, omit with warning). */
  serviceBindingFallbacks?: Record<string, string | null>;
  /**
   * Bindings flagged `dev.remote: true` in wrangler-deploy.config.ts.
   * Each entry is a binding name in this worker's wrangler.jsonc that
   * should be fulfilled by the live Cloudflare resource during dev,
   * grouped by the underlying resource type so the override emitter can
   * write into the right `kv_namespaces` / `d1_databases` / etc. section.
   */
  remoteBindings?: Array<{ binding: string; type: ResourceType }>;
}

export interface DevCompanionPlan {
  name: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
}

export interface WranglerSessionPlan {
  cwd: string;
  entryWorkerPath: string;
  workerPaths: string[];
  configPaths: string[];
  port: number;
  args: string[];
}

export interface DevPlan {
  mode: "workers" | "session";
  workers: WorkerDevPlan[];
  companions: DevCompanionPlan[];
  ports: Record<string, number>;
  session?: WranglerSessionPlan;
}

export interface DevOptions {
  basePort?: number;
  filter?: string;
  stage?: string;
  session?: boolean;
  persistTo?: string;
  workerOptions?: Record<string, { devPort?: number; devArgs?: string[] }>;
  /** Stage name to read fallback deployed-worker names from when --filter excludes service-binding targets. */
  fallbackStage?: string;
  /** State provider used to read fallback stage. Required when fallbackStage is set. */
  stateProvider?: StateProvider;
}

export interface DevHandle {
  /** Actual dev ports resolved at startup (worker path -> port). */
  ports: Record<string, number>;
  processes: Map<string, ReturnType<typeof spawn>>;
  stop(): Promise<void>;
}

function resolveWorkerConfigPath(rootDir: string, workerPath: string): string {
  const jsoncPath = resolve(rootDir, workerPath, "wrangler.jsonc");
  if (existsSync(jsoncPath)) return jsoncPath;

  const jsonPath = resolve(rootDir, workerPath, "wrangler.json");
  if (existsSync(jsonPath)) return jsonPath;

  throw AgentErrors.notFound(
    `No wrangler.jsonc or wrangler.json found for worker "${workerPath}" at ${resolve(rootDir, workerPath)}`,
    "Add a wrangler.jsonc (or wrangler.json) file in the worker directory.",
  );
}

function resolveDevPath(rootDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootDir, path);
}

/**
 * Walk the config and collect every binding marked `dev.remote: true`,
 * grouped by the worker that declares it. Returns a map keyed by worker
 * path so dev plan and override emission can both consume it without
 * re-walking the config.
 *
 * Bindings come in three shapes in this codebase:
 *   - `bindings: { workerPath: "BINDING_NAME" }`         (kv/d1/r2/hyperdrive/vectorize)
 *   - `bindings: { workerPath: { producer: "X" } }`      (queue producers)
 *   - `bindings: { workerPath: { consumer: true, ... } }` (queue consumers)
 *
 * Queue consumers don't have a runtime binding name — they're not
 * something the worker pulls from env — so they're skipped here.
 */
export function computeRemoteBindings(
  config: CfStageConfig,
): Map<string, Array<{ binding: string; type: ResourceType }>> {
  const result = new Map<string, Array<{ binding: string; type: ResourceType }>>();
  for (const [, resource] of Object.entries(config.resources)) {
    if (!resource.dev?.remote) continue;
    for (const [workerPath, binding] of Object.entries(resource.bindings)) {
      let bindingName: string | undefined;
      if (typeof binding === "string") {
        bindingName = binding;
      } else if (binding && typeof binding === "object") {
        if ("producer" in binding && typeof binding.producer === "string") {
          bindingName = binding.producer;
        }
      }
      if (!bindingName) continue;

      const list = result.get(workerPath) ?? [];
      list.push({ binding: bindingName, type: resource.type });
      result.set(workerPath, list);
    }
  }
  return result;
}

interface DevOverridePayload {
  extends?: string;
  services?: Array<{ binding: string; service: string }>;
  kv_namespaces?: Array<{ binding: string; experimental_remote: true }>;
  d1_databases?: Array<{ binding: string; experimental_remote: true }>;
  r2_buckets?: Array<{ binding: string; experimental_remote: true }>;
  hyperdrive?: Array<{ binding: string; experimental_remote: true }>;
  vectorize?: Array<{ binding: string; experimental_remote: true }>;
  queues?: { producers?: Array<{ binding: string; experimental_remote: true }> };
}

const REMOTE_BINDING_FIELDS: Record<ResourceType, keyof DevOverridePayload | "queue-producer" | "skip"> = {
  kv: "kv_namespaces",
  d1: "d1_databases",
  r2: "r2_buckets",
  hyperdrive: "hyperdrive",
  vectorize: "vectorize",
  queue: "queue-producer",
  dns: "skip",
};

export function applyRemoteBindingsToOverride(
  base: DevOverridePayload,
  remoteBindings: Array<{ binding: string; type: ResourceType }>,
): DevOverridePayload {
  const out: DevOverridePayload = { ...base };
  for (const { binding, type } of remoteBindings) {
    const target = REMOTE_BINDING_FIELDS[type];
    if (target === "skip") continue;
    if (target === "queue-producer") {
      out.queues = out.queues ?? {};
      out.queues.producers = out.queues.producers ?? [];
      out.queues.producers.push({ binding, experimental_remote: true });
      continue;
    }
    const list = (out[target] as Array<{ binding: string; experimental_remote: true }> | undefined) ?? [];
    list.push({ binding, experimental_remote: true });
    (out as Record<string, unknown>)[target] = list;
  }
  return out;
}

function writeRenderedDevConfig(
  rootDir: string,
  stage: string,
  workerPath: string,
  config: CfStageConfig,
  state: Awaited<ReturnType<StateProvider["read"]>>,
): string {
  if (!state) {
    throw AgentErrors.state(
      `Stage "${stage}" not found in state.\n` +
      `  Make sure you have run \`wd apply --stage ${stage}\` first, or pass --stage to use a different stage.\n` +
      `  Run \`wd status\` to see available stages.`,
      `Run \`wd apply --stage ${stage}\` first.`,
    );
  }

  const baseConfig = readWranglerConfig(resolve(rootDir, workerPath));
  const rendered = renderWranglerConfig(baseConfig, workerPath, config, state, stage, rootDir);
  const renderedPath = resolve(
    rootDir,
    ".wrangler-deploy",
    "dev",
    stage,
    workerPath,
    "wrangler.rendered.jsonc",
  );
  mkdirSync(resolve(renderedPath, "..", ".."), { recursive: true });
  mkdirSync(resolve(renderedPath, ".."), { recursive: true });
  writeFileSync(
    renderedPath,
    `// Auto-generated by wrangler-deploy. Do not edit.\n// Stage: ${stage} | Generated: ${new Date().toISOString()}\n${JSON.stringify(rendered, null, 2)}\n`,
  );
  return renderedPath;
}

/**
 * Collect transitive service-binding dependencies of a target worker.
 * Returns a set of worker paths including the target itself.
 */
function collectTransitiveDeps(
  target: string,
  serviceBindings: Record<string, Record<string, string>> | undefined,
): Set<string> {
  const result = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (result.has(current)) continue;
    result.add(current);

    const deps = serviceBindings?.[current];
    if (deps) {
      for (const dep of Object.values(deps)) {
        if (!result.has(dep)) {
          queue.push(dep);
        }
      }
    }
  }

  return result;
}

function buildCompanionPlans(
  rootDir: string,
  workers: string[],
  companions: DevCompanionConfig[] | undefined,
): DevCompanionPlan[] {
  if (!companions || companions.length === 0) return [];

  const includedWorkers = new Set(workers);
  return companions
    .filter((companion) => {
      if (!companion.workers || companion.workers.length === 0) return true;
      return companion.workers.some((worker) => includedWorkers.has(worker));
    })
    .map((companion) => ({
      name: companion.name,
      cwd: companion.cwd ? resolveDevPath(rootDir, companion.cwd) : rootDir,
      command: companion.command,
      env: companion.env,
    }));
}

/**
 * Build a dev plan: ordered list of workers with port and wrangler args.
 * Optionally filter to a target worker and its transitive service-binding deps.
 */
export async function buildDevPlan(
  config: CfStageConfig,
  rootDir: string,
  options: DevOptions,
): Promise<DevPlan> {
  const { basePort = 8787, filter, stage, workerOptions, fallbackStage, stateProvider } = options;

  if ((stage || fallbackStage) && !stateProvider) {
    throw AgentErrors.validation("stage/fallback-stage dev requires stateProvider — pass a StateProvider via DevOptions.stateProvider", "Pass a StateProvider via DevOptions.stateProvider when using --stage or --fallback-stage.");
  }

  if (stage && fallbackStage) {
    throw AgentErrors.validation("stage and fallbackStage are not compatible — choose one source of stage state", "Use either --stage or --fallback-stage, not both.");
  }

  if (fallbackStage && stateProvider && (options.session ?? config.dev?.session?.enabled)) {
    throw AgentErrors.validation("read-mode (--fallback-stage) is not compatible with session mode — omit --session or --fallback-stage", "Omit --session or --fallback-stage.");
  }

  let workers: string[];
  const serviceBindingFallbacksByWorker = new Map<string, Record<string, string | null>>();
  let renderedConfigPathsByWorker = new Map<string, string>();
  let stageState: Awaited<ReturnType<StateProvider["read"]>> | undefined;

  if (stage && stateProvider) {
    stageState = await stateProvider.read(stage);
    if (!stageState) {
      const existing = await stateProvider.list();
      const hint = existing.length > 0
        ? `  Available stages: ${existing.join(", ")}`
        : `  No stages exist yet. Run \`wd apply --stage ${stage}\` to create one.`;
      throw AgentErrors.state(
        `Stage "${stage}" not found in state.\n` +
        `  ${hint}\n` +
        `  Use --stage <name> to target a different stage.`,
        `Run \`wd apply --stage ${stage}\` to create the stage, or pass an existing --stage.`,
      );
    }
  }

  if (filter) {
    const allWorkers = new Set(config.workers);
    if (!allWorkers.has(filter)) {
      throw AgentErrors.notFound(`Unknown worker "${filter}" — not found in config. Available workers: ${[...allWorkers].join(", ")}`, "Pass a worker path that exists in `config.workers`.");
    }

    if (fallbackStage && stateProvider) {
      // Read-mode: only run the filter target; inject fallback bindings for its service binding targets.
      workers = [filter];

      const fallbackState = await stateProvider.read(fallbackStage);
      if (!fallbackState) {
        const existing = await stateProvider.list();
        const hint = existing.length > 0
          ? `  Available stages: ${existing.join(", ")}`
          : `  No stages exist yet. Run \`wd apply --stage ${fallbackStage}\` first.`;
        throw AgentErrors.state(
          `Fallback stage "${fallbackStage}" not found in state.\n` +
          `  ${hint}\n` +
          `  Use --fallback-stage <name> or --stage <name> to target a different stage.`,
          `Run \`wd apply --stage ${fallbackStage}\` to create it, or pass an existing --fallback-stage.`,
        );
      }

      const directBindings = config.serviceBindings?.[filter] ?? {};
      const fallbacks: Record<string, string | null> = {};
      for (const [bindingEnvVar, targetWorkerPath] of Object.entries(directBindings)) {
        const workerEntry = fallbackState.workers[targetWorkerPath];
        if (!workerEntry) {
          console.warn(`  Warning: worker "${targetWorkerPath}" not found in fallback stage "${fallbackStage}" — omitting binding "${bindingEnvVar}"`);
          fallbacks[bindingEnvVar] = null;
        } else {
          fallbacks[bindingEnvVar] = workerEntry.name;
        }
      }
      if (Object.keys(fallbacks).length > 0) {
        serviceBindingFallbacksByWorker.set(filter, fallbacks);
      }
    } else {
      // Existing behavior: include transitive deps
      const deps = collectTransitiveDeps(filter, config.serviceBindings);
      const order = resolveDeployOrder(config);
      workers = order.filter((w) => deps.has(w));
    }
  } else {
    workers = resolveDeployOrder(config);
  }

  if (stage && stageState) {
    renderedConfigPathsByWorker = new Map(
      workers.map((workerPath) => [
        workerPath,
        writeRenderedDevConfig(rootDir, stage, workerPath, config, stageState),
      ]),
    );
  }

  const portOverrides: Record<string, number> = {};
  if (config.dev?.ports) {
    Object.assign(portOverrides, config.dev.ports);
  }
  if (workerOptions) {
    for (const [worker, opts] of Object.entries(workerOptions)) {
      if (opts.devPort !== undefined) {
        portOverrides[worker] = opts.devPort;
      }
    }
  }

  const filteredConfig: CfStageConfig = {
    ...config,
    workers,
    deployOrder: workers,
  };
  const ports = assignPorts(filteredConfig, basePort, portOverrides);

  const globalArgs = config.dev?.args ?? [];
  const remoteBindingsByWorker = computeRemoteBindings(config);
  const workerPlans: WorkerDevPlan[] = workers.map((workerPath) => {
    const port = ports[workerPath]!;
    const customArgs = workerOptions?.[workerPath]?.devArgs ?? [];
    const serviceBindingFallbacks = serviceBindingFallbacksByWorker.get(workerPath);
    const configPath = renderedConfigPathsByWorker.get(workerPath) ?? resolveWorkerConfigPath(rootDir, workerPath);
    const remoteBindings = remoteBindingsByWorker.get(workerPath);

    return {
      workerPath,
      cwd: resolve(rootDir, workerPath),
      configPath,
      port,
      args: [...globalArgs, ...customArgs],
      ...(serviceBindingFallbacks ? { serviceBindingFallbacks } : {}),
      ...(remoteBindings && remoteBindings.length > 0 ? { remoteBindings } : {}),
    };
  });

  const companions = buildCompanionPlans(rootDir, workers, config.dev?.companions);
  const sessionEnabled = options.session ?? config.dev?.session?.enabled ?? false;
  const persistTo = options.persistTo ?? config.dev?.session?.persistTo;

  if (sessionEnabled || options.persistTo !== undefined) {
    if (workerPlans.length === 0) {
      throw AgentErrors.config("Cannot start a dev session without any workers.", "Add workers to your config or remove the session/persistTo settings.");
    }

    const entryWorkerPath =
      filter ?? config.dev?.session?.entryWorker ?? workerPlans[workerPlans.length - 1]!.workerPath;
    const entryWorker = workerPlans.find((worker) => worker.workerPath === entryWorkerPath);
    if (!entryWorker) {
      throw AgentErrors.config(`Unable to resolve entry worker "${entryWorkerPath}" for local dev session.`, "Set dev.session.entryWorker to a worker path that exists in `config.workers`.");
    }

    const sessionWorkers = [
      entryWorker,
      ...workerPlans.filter((worker) => worker.workerPath !== entryWorker.workerPath),
    ];

    const sessionArgs: string[] = [];
    for (const worker of sessionWorkers) {
      sessionArgs.push("-c", worker.configPath);
    }
    if (persistTo) {
      sessionArgs.push("--persist-to", resolveDevPath(rootDir, persistTo));
    }
    sessionArgs.push(...globalArgs, ...(config.dev?.session?.args ?? []));

    return {
      mode: "session",
      workers: workerPlans,
      companions,
      ports: {
        [entryWorker.workerPath]: entryWorker.port,
      },
      session: {
        cwd: rootDir,
        entryWorkerPath: entryWorker.workerPath,
        workerPaths: sessionWorkers.map((worker) => worker.workerPath),
        configPaths: sessionWorkers.map((worker) => worker.configPath),
        port: entryWorker.port,
        args: sessionArgs,
      },
    };
  }

  return {
    mode: "workers",
    workers: workerPlans,
    companions,
    ports,
  };
}

function attachProcessLogs(
  proc: ReturnType<typeof spawn>,
  write: (chunk: string) => void,
): void {
  proc.stdout?.on("data", (data: Buffer) => write(data.toString()));
  proc.stderr?.on("data", (data: Buffer) => write(data.toString()));
}

function spawnCompanion(
  companion: DevCompanionPlan,
  env: Record<string, string>,
  write: (chunk: string) => void,
): ReturnType<typeof spawn> {
  const proc = spawn(companion.command, {
    cwd: companion.cwd,
    env: {
      ...process.env,
      ...env,
      ...(companion.env ?? {}),
    },
    shell: true,
  });
  attachProcessLogs(proc, write);
  return proc;
}

/**
 * Start dev servers for all workers in the plan.
 * Probes for available dev and inspector ports before spawning.
 * Pipes stdout/stderr through a log multiplexer.
 * Returns a handle to stop all processes.
 */
export async function startDev(
  plan: DevPlan,
  options?: {
    output?: (line: string) => void;
    logDir?: string;
    rootDir?: string;
    onLine?: (workerPath: string, line: string) => void;
  },
): Promise<DevHandle> {
  const output = options?.output ?? ((line: string) => process.stdout.write(line + "\n"));
  const rootDir = options?.rootDir;
  const mux = createLogMultiplexer(output, { logDir: options?.logDir, onLine: options?.onLine });
  const processes = new Map<string, ReturnType<typeof spawn>>();
  const resolvedPorts: Record<string, number> = {};
  let companionRuntimeEnv: Record<string, string> = {};

  if (plan.mode === "session") {
    const session = plan.session;
    if (!session) {
      throw new Error("Invalid dev plan: session mode requires session details.");
    }

    const usedPorts = new Set<number>();
    const [devPort] = await findAvailablePorts(session.port, 1, usedPorts);
    const [inspectorPort] = await findAvailablePorts(9229, 1, usedPorts);

    output("Starting local dev session:");
    output(`  ${session.entryWorkerPath} -> http://localhost:${devPort}`);
    if (session.workerPaths.length > 1) {
      output(`  includes: ${session.workerPaths.slice(1).join(", ")}`);
    }

    const write = mux.createWriter("wrangler");
    const proc = spawn(
      "npx",
      ["wrangler", "dev", "--port", String(devPort), "--inspector-port", String(inspectorPort), ...session.args],
      {
        cwd: session.cwd,
        shell: false,
      },
    );
    attachProcessLogs(proc, write);
    processes.set(`session:${session.entryWorkerPath}`, proc);
    resolvedPorts[session.entryWorkerPath] = devPort!;
    companionRuntimeEnv = {
      WD_DEV_ENTRY_WORKER: session.entryWorkerPath,
      WD_DEV_ENTRY_URL: `http://127.0.0.1:${devPort}`,
      WD_DEV_PORTS: JSON.stringify(resolvedPorts),
    };
  } else {
    const usedPorts = new Set<number>();
    const devPorts: number[] = [];
    for (const worker of plan.workers) {
      const [resolvedPort] = await findAvailablePorts(worker.port, 1, usedPorts);
      devPorts.push(resolvedPort!);
    }

    const inspectorPorts = await findAvailablePorts(9229, plan.workers.length, usedPorts);

    output("Starting dev servers:");
    for (let i = 0; i < plan.workers.length; i++) {
      const worker = plan.workers[i]!;
      const devPort = devPorts[i]!;
      output(`  ${worker.workerPath} -> http://localhost:${devPort}`);
    }

    for (let i = 0; i < plan.workers.length; i++) {
      const worker = plan.workers[i]!;
      const devPort = devPorts[i]!;
      const inspectorPort = inspectorPorts[i]!;

      // Write dev override config when the worker has either fallback
      // service bindings (--filter excludes deps) or remote-marked bindings.
      let configOverridePath: string | undefined;
      const hasRemote = (worker.remoteBindings?.length ?? 0) > 0;
      const activeFallbacks = worker.serviceBindingFallbacks
        ? Object.entries(worker.serviceBindingFallbacks).filter(([, name]) => name !== null)
        : [];
      if (rootDir && (activeFallbacks.length > 0 || hasRemote)) {
        const overrideDir = resolve(rootDir, ".wrangler-deploy", "dev", worker.workerPath);
        const overridePath = resolve(overrideDir, "wrangler.dev.jsonc");
        mkdirSync(overrideDir, { recursive: true });
        const extendsPath = relative(overrideDir, worker.configPath);
        let overrideContent: DevOverridePayload = {
          extends: extendsPath,
          ...(activeFallbacks.length > 0
            ? {
                services: activeFallbacks.map(([binding, service]) => ({
                  binding,
                  service: service!,
                })),
              }
            : {}),
        };
        if (worker.remoteBindings) {
          overrideContent = applyRemoteBindingsToOverride(overrideContent, worker.remoteBindings);
        }
        writeFileSync(overridePath, JSON.stringify(overrideContent, null, 2) + "\n");
        configOverridePath = overridePath;
      }

      const args = [
        "dev",
        "--port", String(devPort),
        "--inspector-port", String(inspectorPort),
        ...(configOverridePath ? ["--config", configOverridePath] : []),
        ...worker.args,
      ];

      const write = mux.createWriter(worker.workerPath);
      const proc = spawn("npx", ["wrangler", ...args], {
        cwd: worker.cwd,
        shell: false,
      });

      attachProcessLogs(proc, write);
      processes.set(worker.workerPath, proc);
      resolvedPorts[worker.workerPath] = devPort;
    }
    companionRuntimeEnv = {
      WD_DEV_PORTS: JSON.stringify(resolvedPorts),
    };
  }

  if (plan.companions.length > 0) {
    output("Starting companion processes:");
    for (const companion of plan.companions) {
      output(`  ${companion.name} -> ${companion.command}`);
      const proc = spawnCompanion(companion, companionRuntimeEnv, mux.createWriter(companion.name));
      processes.set(`companion:${companion.name}`, proc);
    }
  }

  return {
    ports: resolvedPorts,
    processes,
    async stop() {
      await Promise.all(
        [...processes.values()].map(
          (proc) =>
            new Promise<void>((resolveStop) => {
              if (proc.exitCode !== null || proc.killed) {
                resolveStop();
                return;
              }

              const timeout = setTimeout(() => {
                resolveStop();
              }, 2_000);

              const done = () => {
                clearTimeout(timeout);
                resolveStop();
              };

              proc.once("exit", done);
              proc.once("error", done);
              proc.kill();
            }),
        ),
      );
    },
  };
}
