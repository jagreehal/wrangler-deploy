import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CfStageConfig,
  D1ResourceConfig,
  QueueBinding,
  WranglerConfig,
} from "../types.js";
import { buildDevPlan } from "./dev.js";
import { readActiveDevState } from "./dev-runtime-state.js";
import type { WranglerRunner } from "./wrangler-runner.js";

export interface QueueRoute {
  logicalName: string;
  producers: Array<{ workerPath: string; binding: string }>;
  consumers: Array<{ workerPath: string }>;
  deadLetterFor?: string;
}

export interface CronTriggerOptions {
  port: number;
  cron?: string;
  time?: string;
  path?: string;
}

export interface CronTriggerResult {
  url: string;
  status: number;
  ok: boolean;
  body: string;
}

export interface WorkerCallTarget {
  workerPath: string;
  port: number;
  path: string;
  url: string;
}

export interface WorkerCallOptions {
  worker: string;
  endpoint?: string;
  method?: string;
  port?: number;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string;
}

export interface WorkerCallResult {
  target: WorkerCallTarget;
  method: string;
  status: number;
  ok: boolean;
  body: string;
  headers: Record<string, string>;
}

export interface WorkerRouteSummary {
  workerPath: string;
  port: number;
  url: string;
  endpoints: Array<{
    name: string;
    path: string;
    method?: string;
    description?: string;
    url: string;
  }>;
}

export interface D1DatabaseRoute {
  logicalName: string;
  bindings: Array<{ workerPath: string; binding: string }>;
}

export interface D1CommandTarget {
  database: string;
  workerPath: string;
  binding: string;
  cwd: string;
  wranglerArgs: string[];
}

export interface D1ExecOptions {
  database: string;
  worker?: string;
  sql?: string;
  file?: string;
}

export interface D1ExecResult {
  target: D1CommandTarget;
  output: string;
}

export interface DevLogSnapshotOptions {
  worker?: string;
  grep?: string;
}

export interface QueueSendTarget {
  queue: string;
  workerPath: string;
  port: number;
  path: string;
  url: string;
}

export interface QueueSendOptions {
  queue: string;
  payload: string;
  worker?: string;
  port?: number;
  path?: string;
}

export interface QueueSendResult {
  target: QueueSendTarget;
  status: number;
  ok: boolean;
  body: string;
}

export interface QueueReplayResult {
  target: QueueSendTarget;
  sent: number;
  results: QueueSendResult[];
}

export interface QueueTailOptions {
  queue: string;
  worker?: string;
}

function queueTailPattern(queue: string): RegExp {
  const escaped = queue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const routePath = `/__wd/queues/${encodeURIComponent(queue).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  return new RegExp(`(?:\\[queue:${escaped}\\]|${routePath})`, "i");
}

export interface DevDoctorDeps {
  workerExists: (path: string) => boolean;
  readWorkerConfig: (workerDir: string) => WranglerConfig;
  pathExists: (path: string) => boolean;
}

export function listQueueRoutes(config: CfStageConfig): QueueRoute[] {
  return Object.entries(config.resources)
    .filter(([, resource]) => resource.type === "queue")
    .map(([logicalName, resource]) => {
      const route: QueueRoute = {
        logicalName,
        producers: [],
        consumers: [],
      };

      for (const [workerPath, binding] of Object.entries(resource.bindings)) {
        if (typeof binding === "string") {
          route.producers.push({ workerPath, binding });
          continue;
        }

        const queueBinding = binding as Exclude<QueueBinding, string>;
        if ("producer" in queueBinding && queueBinding.producer) {
          route.producers.push({ workerPath, binding: queueBinding.producer });
        }
        if ("consumer" in queueBinding && queueBinding.consumer) {
          route.consumers.push({ workerPath });
        }
        if ("deadLetterFor" in queueBinding) {
          route.deadLetterFor = queueBinding.deadLetterFor;
        }
      }

      return route;
    });
}

export function getQueueRoute(config: CfStageConfig, logicalName: string): QueueRoute | undefined {
  return listQueueRoutes(config).find((route) => route.logicalName === logicalName);
}

function defaultQueueSendPath(logicalName: string): string {
  return `/__wd/queues/${encodeURIComponent(logicalName)}`;
}

export async function resolvePlannedWorkerPort(
  config: CfStageConfig,
  rootDir: string,
  workerPath: string,
): Promise<number> {
  const activeState = readActiveDevState(rootDir);
  if (activeState?.ports[workerPath] !== undefined) {
    return activeState.ports[workerPath]!;
  }

  const plan = await buildDevPlan(config, rootDir, { filter: workerPath });
  const plannedPort = plan.mode === "session"
    ? plan.session?.port
    : plan.workers.find((worker) => worker.workerPath === workerPath)?.port;

  if (!plannedPort) {
    throw new Error(`Unable to resolve a planned dev port for "${workerPath}"`);
  }

  return plannedPort;
}

export function resolveQueueTailLogFiles(
  config: CfStageConfig,
  rootDir: string,
  options: QueueTailOptions,
): Array<{ workerPath: string; logFile: string }> {
  const route = getQueueRoute(config, options.queue);
  if (!route) {
    throw new Error(`Unknown queue "${options.queue}"`);
  }

  const activeState = readActiveDevState(rootDir);
  if (!activeState) {
    throw new Error("No active dev runtime state found. Start `wd dev` first.");
  }

  const relatedWorkers = options.worker
    ? [options.worker]
    : [...new Set([
      ...route.producers.map((producer) => producer.workerPath),
      ...route.consumers.map((consumer) => consumer.workerPath),
    ])];
  if (relatedWorkers.length === 0) {
    throw new Error(`Queue "${options.queue}" has no related workers to tail.`);
  }

  return relatedWorkers.map((workerPath) => {
    const logFile = activeState.logFiles[workerPath];
    if (!logFile) {
      throw new Error(`No active log file found for "${workerPath}". Start \`wd dev\` first.`);
    }
    return { workerPath, logFile };
  });
}

export async function resolveQueueSendTarget(
  config: CfStageConfig,
  rootDir: string,
  options: { queue: string; worker?: string; port?: number; path?: string },
): Promise<QueueSendTarget> {
  const route = getQueueRoute(config, options.queue);
  if (!route) {
    throw new Error(`Unknown queue "${options.queue}"`);
  }

  const configuredRoute = config.dev?.queues?.[options.queue];
  const producerWorkers = new Set(route.producers.map((producer) => producer.workerPath));

  let workerPath = options.worker ?? configuredRoute?.worker;
  if (!workerPath) {
    if (producerWorkers.size !== 1) {
      throw new Error(
        `Queue "${options.queue}" has multiple producers. Configure dev.queues["${options.queue}"] or pass --worker.`,
      );
    }
    workerPath = route.producers[0]!.workerPath;
  }

  if (!producerWorkers.has(workerPath)) {
    throw new Error(`Worker "${workerPath}" is not a producer for queue "${options.queue}"`);
  }

  const port = options.port ?? await resolvePlannedWorkerPort(config, rootDir, workerPath);
  const path = options.path ?? configuredRoute?.path ?? defaultQueueSendPath(options.queue);
  const url = new URL(path, `http://127.0.0.1:${port}`).toString();

  return {
    queue: options.queue,
    workerPath,
    port,
    path,
    url,
  };
}

export async function resolveWorkerCallTarget(
  config: CfStageConfig,
  rootDir: string,
  options: { worker: string; endpoint?: string; port?: number; path?: string; query?: Record<string, string> },
): Promise<WorkerCallTarget> {
  const configuredEndpoint = options.endpoint ? config.dev?.endpoints?.[options.endpoint] : undefined;
  const worker = configuredEndpoint?.worker ?? options.worker;
  if (!config.workers.includes(worker)) {
    throw new Error(`Unknown worker "${worker}"`);
  }

  if (configuredEndpoint && options.worker !== worker) {
    throw new Error(
      `Endpoint "${options.endpoint}" belongs to "${worker}", not "${options.worker}"`,
    );
  }

  const port = options.port ?? await resolvePlannedWorkerPort(config, rootDir, worker);
  const path = options.path ?? configuredEndpoint?.path ?? "/";
  const url = new URL(path, `http://127.0.0.1:${port}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  return {
    workerPath: worker,
    port,
    path,
    url: url.toString(),
  };
}

export async function triggerCron(options: CronTriggerOptions): Promise<CronTriggerResult> {
  const path = options.path ?? "/cdn-cgi/handler/scheduled";
  const url = new URL(path, `http://127.0.0.1:${options.port}`);

  if (options.cron) {
    url.searchParams.set("cron", options.cron);
  }
  if (options.time) {
    url.searchParams.set("time", options.time);
  }

  const response = await fetch(url);
  const body = await response.text();

  return {
    url: url.toString(),
    status: response.status,
    ok: response.ok,
    body,
  };
}

export async function sendQueueMessage(
  config: CfStageConfig,
  rootDir: string,
  options: QueueSendOptions,
): Promise<QueueSendResult> {
  const target = await resolveQueueSendTarget(config, rootDir, options);
  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: options.payload,
  });
  const body = await response.text();

  return {
    target,
    status: response.status,
    ok: response.ok,
    body,
  };
}

export async function callWorker(
  config: CfStageConfig,
  rootDir: string,
  options: WorkerCallOptions,
): Promise<WorkerCallResult> {
  const target = await resolveWorkerCallTarget(config, rootDir, options);
  const method = (
    options.method
    ?? (options.endpoint ? config.dev?.endpoints?.[options.endpoint]?.method : undefined)
    ?? "GET"
  ).toUpperCase();
  const response = await fetch(target.url, {
    method,
    headers: options.headers,
    body: options.body,
  });
  const body = await response.text();

  return {
    target,
    method,
    status: response.status,
    ok: response.ok,
    body,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

export async function listWorkerRoutes(config: CfStageConfig, rootDir: string): Promise<WorkerRouteSummary[]> {
  const endpointEntries = Object.entries(config.dev?.endpoints ?? {});
  const routes: WorkerRouteSummary[] = [];
  for (const workerPath of config.workers) {
    const port = await resolvePlannedWorkerPort(config, rootDir, workerPath);
    const url = `http://127.0.0.1:${port}`;
    const endpoints = endpointEntries
      .filter(([, endpoint]) => endpoint.worker === workerPath)
      .map(([name, endpoint]) => ({
        name,
        path: endpoint.path,
        method: endpoint.method,
        description: endpoint.description,
        url: new URL(endpoint.path, url).toString(),
      }));

    routes.push({
      workerPath,
      port,
      url,
      endpoints,
    });
  }
  return routes;
}

export function listD1Databases(config: CfStageConfig): D1DatabaseRoute[] {
  return Object.entries(config.resources)
    .filter(([, resource]) => resource.type === "d1")
    .map(([logicalName, resource]) => ({
      logicalName,
      bindings: Object.entries((resource as D1ResourceConfig).bindings).map(([workerPath, binding]) => ({
        workerPath,
        binding,
      })),
    }));
}

export function getD1Database(config: CfStageConfig, logicalName: string): D1DatabaseRoute | undefined {
  return listD1Databases(config).find((database) => database.logicalName === logicalName);
}

export function resolveD1CommandTarget(
  config: CfStageConfig,
  rootDir: string,
  options: { database: string; worker?: string },
): D1CommandTarget {
  const database = getD1Database(config, options.database);
  if (!database) {
    throw new Error(`Unknown D1 database "${options.database}"`);
  }

  const configuredWorker = config.dev?.d1?.[options.database]?.worker;
  let workerPath = options.worker ?? configuredWorker;
  if (!workerPath) {
    if (database.bindings.length !== 1) {
      throw new Error(
        `D1 database "${options.database}" is bound in multiple workers. Configure dev.d1["${options.database}"].worker or pass --worker.`,
      );
    }
    workerPath = database.bindings[0]!.workerPath;
  }

  const binding = database.bindings.find((entry) => entry.workerPath === workerPath)?.binding;
  if (!binding) {
    throw new Error(`Worker "${workerPath}" does not bind D1 database "${options.database}"`);
  }

  return {
    database: options.database,
    workerPath,
    binding,
    cwd: resolve(rootDir, workerPath),
    wranglerArgs: ["d1", "execute", options.database, "--local"],
  };
}

export function executeLocalD1(
  config: CfStageConfig,
  rootDir: string,
  wrangler: WranglerRunner,
  options: D1ExecOptions,
): D1ExecResult {
  const target = resolveD1CommandTarget(config, rootDir, options);
  const commandArgs = [...target.wranglerArgs];

  if (options.sql) {
    commandArgs.push("--command", options.sql);
  } else if (options.file) {
    commandArgs.push("--file", resolve(rootDir, options.file));
  } else {
    throw new Error("D1 execution requires --sql or --file.");
  }

  return {
    target,
    output: wrangler.run(commandArgs, target.cwd, { localOnly: true }),
  };
}

export async function replayQueueMessages(
  config: CfStageConfig,
  rootDir: string,
  options: Omit<QueueSendOptions, "payload"> & { payloads: string[] },
): Promise<QueueReplayResult> {
  const target = await resolveQueueSendTarget(config, rootDir, options);
  const results: QueueSendResult[] = [];

  for (const payload of options.payloads) {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: payload,
    });
    const body = await response.text();
    results.push({
      target,
      status: response.status,
      ok: response.ok,
      body,
    });
  }

  return {
    target,
    sent: results.length,
    results,
  };
}

export function readQueueTailSnapshot(
  config: CfStageConfig,
  rootDir: string,
  options: QueueTailOptions,
): Array<{ workerPath: string; logFile: string; content: string }> {
  const pattern = queueTailPattern(options.queue);
  return resolveQueueTailLogFiles(config, rootDir, options).map(({ workerPath, logFile }) => {
    const raw = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    const content = raw
      .split("\n")
      .filter((line) => pattern.test(line))
      .join("\n");

    return {
      workerPath,
      logFile,
      content,
    };
  });
}

export function readDevLogSnapshot(
  config: CfStageConfig,
  rootDir: string,
  options: DevLogSnapshotOptions = {},
): Array<{ workerPath: string; logFile: string; content: string }> {
  const activeState = readActiveDevState(rootDir);
  if (!activeState) {
    throw new Error("No active dev runtime state found. Start `wd dev` first.");
  }

  const workerPaths = options.worker ? [options.worker] : activeState.workers;
  if (options.worker && !config.workers.includes(options.worker)) {
    throw new Error(`Unknown worker "${options.worker}"`);
  }
  const grep = options.grep ? new RegExp(options.grep, "i") : undefined;

  return workerPaths.map((workerPath) => {
    const logFile = activeState.logFiles[workerPath];
    if (!logFile) {
      throw new Error(`No active log file found for "${workerPath}". Start \`wd dev\` first.`);
    }
    const raw = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    const content = grep
      ? raw.split("\n").filter((line) => grep.test(line)).join("\n")
      : raw;

    return {
      workerPath,
      logFile,
      content,
    };
  });
}

export function parseInterval(input: string): number {
  const match = /^(\d+)(ms|s|m)?$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid interval "${input}". Use values like 500ms, 5s, or 1m.`);
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2] ?? "ms";
  if (unit === "ms") return value;
  if (unit === "s") return value * 1_000;
  return value * 60_000;
}

export async function runDevDoctor(
  config: CfStageConfig,
  rootDir: string,
  deps: DevDoctorDeps,
): Promise<Array<{ name: string; status: "pass" | "warn" | "fail"; message: string; details?: string }>> {
  const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string; details?: string }> = [];

  for (const workerPath of config.workers) {
    const exists = deps.workerExists(workerPath);
    checks.push({
      name: `dev worker config: ${workerPath}`,
      status: exists ? "pass" : "fail",
      message: exists ? "wrangler config found" : "wrangler config missing",
    });

    if (!exists) continue;

    try {
      const workerConfig = deps.readWorkerConfig(resolve(rootDir, workerPath));
      const hasCrons = (workerConfig.triggers?.crons?.length ?? 0) > 0;
      if (hasCrons) {
        checks.push({
          name: `cron route: ${workerPath}`,
          status: "pass",
          message: `${workerConfig.triggers!.crons!.length} cron trigger(s) configured`,
          details: "Use `wd cron trigger <worker>` against a running local dev server.",
        });
      }
    } catch (error) {
      checks.push({
        name: `dev worker config: ${workerPath}`,
        status: "fail",
        message: "failed to parse wrangler config",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (config.dev?.session?.entryWorker) {
    const exists = config.workers.includes(config.dev.session.entryWorker);
    checks.push({
      name: "dev session entry worker",
      status: exists ? "pass" : "fail",
      message: exists
        ? `${config.dev.session.entryWorker} is declared`
        : `${config.dev.session.entryWorker} is not in workers[]`,
    });
  }

  for (const companion of config.dev?.companions ?? []) {
    const cwd = companion.cwd ? resolve(rootDir, companion.cwd) : rootDir;
    const cwdExists = deps.pathExists(cwd);
    checks.push({
      name: `companion cwd: ${companion.name}`,
      status: cwdExists ? "pass" : "fail",
      message: cwdExists ? cwd : "directory missing",
      details: cwdExists ? undefined : cwd,
    });

    if (companion.workers) {
      const unknownWorkers = companion.workers.filter((workerPath) => !config.workers.includes(workerPath));
      if (unknownWorkers.length > 0) {
        checks.push({
          name: `companion workers: ${companion.name}`,
          status: "fail",
          message: `unknown worker references: ${unknownWorkers.join(", ")}`,
        });
      }
    }
  }

  for (const [logicalName, queueRoute] of Object.entries(config.dev?.queues ?? {})) {
    const route = getQueueRoute(config, logicalName);
    if (!route) {
      checks.push({
        name: `queue route: ${logicalName}`,
        status: "fail",
        message: "queue is not declared in resources",
      });
      continue;
    }

    const isProducer = route.producers.some((producer) => producer.workerPath === queueRoute.worker);
    checks.push({
      name: `queue route: ${logicalName}`,
      status: isProducer ? "pass" : "fail",
      message: isProducer
        ? `${queueRoute.worker} can inject this queue locally`
        : `${queueRoute.worker} is not a producer for this queue`,
      details: queueRoute.path ?? defaultQueueSendPath(logicalName),
    });
  }

  const queues = listQueueRoutes(config);
  if (queues.length === 0) {
    checks.push({
      name: "queue topology",
      status: "pass",
      message: "No queues declared",
    });
  } else {
    for (const queue of queues) {
      const hasProducer = queue.producers.length > 0;
      const hasConsumer = queue.consumers.length > 0;
      checks.push({
        name: `queue: ${queue.logicalName}`,
        status: hasProducer && hasConsumer ? "pass" : "warn",
        message: `${queue.producers.length} producer(s), ${queue.consumers.length} consumer(s)`,
        details: hasProducer && hasConsumer
          ? "Queue flow is wired for local end-to-end testing."
          : "Queue is only partially wired in config; local flow may be one-sided.",
      });
    }
  }

  const portPlan = await buildDevPlan(config, rootDir, {});
  const portEntries = Object.entries(portPlan.ports);
  const duplicatePorts = new Map<number, string[]>();
  for (const [workerPath, port] of portEntries) {
    const workers = duplicatePorts.get(port) ?? [];
    workers.push(workerPath);
    duplicatePorts.set(port, workers);
  }
  for (const [port, workers] of duplicatePorts.entries()) {
    checks.push({
      name: `dev port: ${port}`,
      status: workers.length === 1 ? "pass" : "fail",
      message: workers.length === 1 ? `${workers[0]} assigned` : `port collision across ${workers.join(", ")}`,
    });
  }

  for (const [sourceWorker, bindings] of Object.entries(config.serviceBindings ?? {})) {
    for (const [bindingName, targetWorker] of Object.entries(bindings)) {
      checks.push({
        name: `service binding: ${sourceWorker}.${bindingName}`,
        status: config.workers.includes(targetWorker) ? "pass" : "fail",
        message: config.workers.includes(targetWorker)
          ? `targets ${targetWorker}`
          : `unknown target worker ${targetWorker}`,
      });
    }
  }

  for (const [endpointName, endpoint] of Object.entries(config.dev?.endpoints ?? {})) {
    checks.push({
      name: `endpoint: ${endpointName}`,
      status: config.workers.includes(endpoint.worker) ? "pass" : "fail",
      message: config.workers.includes(endpoint.worker)
        ? `${endpoint.worker} ${endpoint.method ?? "GET"} ${endpoint.path}`
        : `unknown worker ${endpoint.worker}`,
    });
  }

  for (const [databaseName, d1Config] of Object.entries(config.dev?.d1 ?? {})) {
    const database = getD1Database(config, databaseName);
    if (!database) {
      checks.push({
        name: `d1 workflow: ${databaseName}`,
        status: "fail",
        message: "database is not declared in resources",
      });
      continue;
    }

    if (d1Config.worker) {
      const binding = database.bindings.find((entry) => entry.workerPath === d1Config.worker);
      checks.push({
        name: `d1 workflow: ${databaseName}`,
        status: binding ? "pass" : "fail",
        message: binding
          ? `${d1Config.worker} binds ${binding.binding}`
          : `${d1Config.worker} does not bind this database`,
      });
    }

    if (d1Config.seedFile) {
      const seedPath = resolve(rootDir, d1Config.seedFile);
      checks.push({
        name: `d1 seed file: ${databaseName}`,
        status: deps.pathExists(seedPath) ? "pass" : "fail",
        message: deps.pathExists(seedPath) ? seedPath : "file missing",
      });
    }

    if (d1Config.resetFile) {
      const resetPath = resolve(rootDir, d1Config.resetFile);
      checks.push({
        name: `d1 reset file: ${databaseName}`,
        status: deps.pathExists(resetPath) ? "pass" : "fail",
        message: deps.pathExists(resetPath) ? resetPath : "file missing",
      });
    }
  }

  return checks;
}
