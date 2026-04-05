import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { CfStageConfig } from "../types.js";
import { resolveDeployOrder } from "./graph.js";
import { assignPorts } from "./dev-ports.js";
import { createLogMultiplexer } from "./dev-logs.js";
import { findAvailablePorts } from "./port-finder.js";

export interface WorkerDevPlan {
  workerPath: string;
  cwd: string;
  port: number;
  args: string[];
}

export interface DevPlan {
  workers: WorkerDevPlan[];
  ports: Record<string, number>;
}

export interface DevOptions {
  basePort?: number;
  filter?: string;
  workerOptions?: Record<string, { devPort?: number; devArgs?: string[] }>;
}

export interface DevHandle {
  /** Actual dev ports resolved at startup (worker path -> port). */
  ports: Record<string, number>;
  processes: Map<string, ReturnType<typeof spawn>>;
  stop(): Promise<void>;
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

  // Determine the set of workers to include
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

  // Build port overrides from workerOptions
  const portOverrides: Record<string, number> = {};
  if (workerOptions) {
    for (const [worker, opts] of Object.entries(workerOptions)) {
      if (opts.devPort !== undefined) {
        portOverrides[worker] = opts.devPort;
      }
    }
  }

  // Assign ports for the filtered set only
  const filteredConfig: CfStageConfig = {
    ...config,
    workers,
    deployOrder: workers,
  };
  const ports = assignPorts(filteredConfig, basePort, portOverrides);

  // Build per-worker plans (inspector ports resolved later by startDev)
  const workerPlans: WorkerDevPlan[] = workers.map((workerPath) => {
    const port = ports[workerPath]!;
    const customArgs = workerOptions?.[workerPath]?.devArgs ?? [];

    return {
      workerPath,
      cwd: resolve(rootDir, workerPath),
      port,
      args: customArgs,
    };
  });

  return { workers: workerPlans, ports };
}

/**
 * Start dev servers for all workers in the plan.
 * Probes for available dev and inspector ports before spawning.
 * Pipes stdout/stderr through a log multiplexer.
 * Returns a handle to stop all processes.
 */
export async function startDev(
  plan: DevPlan,
  options?: { output?: (line: string) => void },
): Promise<DevHandle> {
  const output = options?.output ?? ((line: string) => process.stdout.write(line + "\n"));
  const mux = createLogMultiplexer(output);

  // Probe each planned dev port individually so explicit overrides remain stable when free.
  const usedPorts = new Set<number>();
  const devPorts: number[] = [];
  for (const worker of plan.workers) {
    const [resolvedPort] = await findAvailablePorts(worker.port, 1, usedPorts);
    devPorts.push(resolvedPort!);
  }

  // Probe for available inspector ports starting at 9229
  const inspectorPorts = await findAvailablePorts(9229, plan.workers.length, usedPorts);

  // Print port map
  output("Starting dev servers:");
  for (let i = 0; i < plan.workers.length; i++) {
    const worker = plan.workers[i]!;
    const devPort = devPorts[i]!;
    output(`  ${worker.workerPath} -> http://localhost:${devPort}`);
  }

  const processes = new Map<string, ReturnType<typeof spawn>>();

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

    proc.stdout?.on("data", (data: Buffer) => write(data.toString()));
    proc.stderr?.on("data", (data: Buffer) => write(data.toString()));

    processes.set(worker.workerPath, proc);
  }

  // Build resolved port map
  const resolvedPorts: Record<string, number> = {};
  for (let i = 0; i < plan.workers.length; i++) {
    resolvedPorts[plan.workers[i]!.workerPath] = devPorts[i]!;
  }

  return {
    ports: resolvedPorts,
    processes,
    async stop() {
      await Promise.all(
        [...processes.values()].map(
          (proc) =>
            new Promise<void>((resolve) => {
              if (proc.exitCode !== null || proc.killed) {
                resolve();
                return;
              }

              const timeout = setTimeout(() => {
                resolve();
              }, 2_000);

              const done = () => {
                clearTimeout(timeout);
                resolve();
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
