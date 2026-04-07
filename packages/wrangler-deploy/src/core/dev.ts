import { existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import type { CfStageConfig, DevCompanionConfig } from "../types.js";
import { resolveDeployOrder } from "./graph.js";
import { assignPorts } from "./dev-ports.js";
import { createLogMultiplexer } from "./dev-logs.js";
import { findAvailablePorts } from "./port-finder.js";

export interface WorkerDevPlan {
  workerPath: string;
  cwd: string;
  configPath: string;
  port: number;
  args: string[];
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
  session?: boolean;
  persistTo?: string;
  workerOptions?: Record<string, { devPort?: number; devArgs?: string[] }>;
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

  throw new Error(
    `No wrangler.jsonc or wrangler.json found for worker "${workerPath}" at ${resolve(rootDir, workerPath)}`,
  );
}

function resolveDevPath(rootDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootDir, path);
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
export function buildDevPlan(
  config: CfStageConfig,
  rootDir: string,
  options: DevOptions,
): DevPlan {
  const { basePort = 8787, filter, workerOptions } = options;

  let workers: string[];
  if (filter) {
    const allWorkers = new Set(config.workers);
    if (!allWorkers.has(filter)) {
      throw new Error(`Unknown worker "${filter}" — not found in config. Available workers: ${[...allWorkers].join(", ")}`);
    }
    const deps = collectTransitiveDeps(filter, config.serviceBindings);
    const order = resolveDeployOrder(config);
    workers = order.filter((w) => deps.has(w));
  } else {
    workers = resolveDeployOrder(config);
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
  const workerPlans: WorkerDevPlan[] = workers.map((workerPath) => {
    const port = ports[workerPath]!;
    const customArgs = workerOptions?.[workerPath]?.devArgs ?? [];

    return {
      workerPath,
      cwd: resolve(rootDir, workerPath),
      configPath: resolveWorkerConfigPath(rootDir, workerPath),
      port,
      args: [...globalArgs, ...customArgs],
    };
  });

  const companions = buildCompanionPlans(rootDir, workers, config.dev?.companions);
  const sessionEnabled = options.session ?? config.dev?.session?.enabled ?? false;
  const persistTo = options.persistTo ?? config.dev?.session?.persistTo;

  if (sessionEnabled || options.persistTo !== undefined) {
    if (workerPlans.length === 0) {
      throw new Error("Cannot start a dev session without any workers.");
    }

    const entryWorkerPath =
      filter ?? config.dev?.session?.entryWorker ?? workerPlans[workerPlans.length - 1]!.workerPath;
    const entryWorker = workerPlans.find((worker) => worker.workerPath === entryWorkerPath);
    if (!entryWorker) {
      throw new Error(`Unable to resolve entry worker "${entryWorkerPath}" for local dev session.`);
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
  options?: { output?: (line: string) => void; logDir?: string },
): Promise<DevHandle> {
  const output = options?.output ?? ((line: string) => process.stdout.write(line + "\n"));
  const mux = createLogMultiplexer(output, { logDir: options?.logDir });
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
      const args = ["dev", "--port", String(devPort), "--inspector-port", String(inspectorPort), ...worker.args];

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
