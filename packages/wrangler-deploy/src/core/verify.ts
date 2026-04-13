import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CfStageConfig, LocalVerifyCheckConfig } from "../types.js";
import { isActive, resourceStagedName } from "../types.js";
import type { StateProvider } from "./state.js";
import { getD1Fixture, getQueueFixture, getWorkerFixture } from "./fixtures.js";
import { callWorker, executeLocalD1, resolvePlannedWorkerPort, sendQueueMessage, triggerCron } from "./runtime.js";
import { createWranglerRunner, type WranglerRunner } from "./wrangler-runner.js";

export interface VerifyResult {
  passed: boolean;
  checks: VerifyCheck[];
}

export interface VerifyCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export type VerifyArgs = {
  stage: string;
};

export type VerifyDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  existsFn?: typeof existsSync;
};

export interface LocalVerifyResult {
  passed: boolean;
  checks: VerifyCheck[];
  pack?: string;
}

export interface LocalVerifyDeps {
  rootDir: string;
  config: CfStageConfig;
  pack?: string;
  wrangler?: WranglerRunner;
  callWorkerFn?: typeof callWorker;
  sendQueueMessageFn?: typeof sendQueueMessage;
  triggerCronFn?: typeof triggerCron;
  resolvePlannedWorkerPortFn?: typeof resolvePlannedWorkerPort;
  executeLocalD1Fn?: typeof executeLocalD1;
}

export async function verify(args: VerifyArgs, deps: VerifyDeps): Promise<VerifyResult> {
  const { stage } = args;
  const { rootDir, config, state: provider } = deps;
  const checkExists = deps.existsFn ?? existsSync;
  const state = await provider.read(stage);
  const checks: VerifyCheck[] = [];

  // 1. State file exists
  checks.push({
    name: "State file exists",
    passed: state !== null,
    details: state
      ? undefined
      : config.state?.backend === "kv"
        ? `No state in KV for stage "${stage}"`
        : `No state at .wrangler-deploy/${stage}/state.json`,
  });

  if (!state) {
    return { passed: false, checks };
  }

  // 2. Rendered configs exist for all workers
  for (const workerPath of config.workers) {
    const renderedPath = join(
      rootDir,
      ".wrangler-deploy",
      stage,
      workerPath,
      "wrangler.rendered.jsonc",
    );
    const exists = checkExists(renderedPath);
    checks.push({
      name: `Rendered config: ${workerPath}`,
      passed: exists,
      details: exists ? undefined : `Missing: ${renderedPath}`,
    });
  }

  // 3. Every resource in state is active
  for (const [_name, resource] of Object.entries(state.resources)) {
    const active = isActive(resource);
    checks.push({
      name: `Resource: ${resourceStagedName(resource)}`,
      passed: active,
      details: active ? undefined : `Status: ${resource.lifecycleStatus}`,
    });
  }

  // 4. Every resource in manifest exists in state
  for (const [name, _resource] of Object.entries(config.resources)) {
    const inState = name in state.resources;
    checks.push({
      name: `Manifest resource in state: ${name}`,
      passed: inState,
      details: inState ? undefined : `Resource "${name}" declared in manifest but not in state`,
    });
  }

  // 5. Every worker has a name in state
  for (const workerPath of config.workers) {
    const workerState = state.workers[workerPath];
    const hasName = !!workerState?.name;
    checks.push({
      name: `Worker registered: ${workerPath}`,
      passed: hasName,
      details: hasName ? workerState.name : `Worker "${workerPath}" not in state`,
    });
  }

  // 5b. No stale workers in state that are not in the manifest
  const declaredWorkers = new Set(config.workers);
  for (const workerPath of Object.keys(state.workers)) {
    if (!declaredWorkers.has(workerPath)) {
      checks.push({
        name: `Undeclared worker in state: ${workerPath}`,
        passed: false,
        details: `Worker "${workerPath}" is in state but not declared in manifest — run apply to clean up`,
      });
    }
  }

  // 6. Every declared secret is accounted for
  if (config.secrets) {
    for (const [workerPath, secretNames] of Object.entries(config.secrets)) {
      for (const secretName of secretNames) {
        const secretStatus = state.secrets[workerPath]?.[secretName];
        const isSet = secretStatus === "set";
        checks.push({
          name: `Secret: ${workerPath}/${secretName}`,
          passed: isSet,
          details: isSet ? undefined : `Status: ${secretStatus ?? "not checked"}`,
        });
      }
    }
  }

  // 7. Service binding targets exist in state
  if (config.serviceBindings) {
    for (const [workerPath, bindings] of Object.entries(config.serviceBindings)) {
      for (const [bindingName, targetWorker] of Object.entries(bindings)) {
        const targetExists = targetWorker in state.workers;
        checks.push({
          name: `Service binding: ${workerPath}.${bindingName} -> ${targetWorker}`,
          passed: targetExists,
          details: targetExists
            ? state.workers[targetWorker]?.name
            : `Target worker "${targetWorker}" not in state`,
        });
      }
    }
  }

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}

function includesAll(haystack: string, needles: string[] | undefined): boolean {
  return (needles ?? []).every((needle) => haystack.includes(needle));
}

function matchesHeaders(
  actual: Record<string, string>,
  expected: Record<string, string> | undefined,
): boolean {
  return Object.entries(expected ?? {}).every(([key, value]) => actual[key.toLowerCase()] === value);
}

function deepIncludes(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (actual === expected) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((expectedValue, index) => deepIncludes(actual[index], expectedValue));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([key, value]) =>
      deepIncludes((actual as Record<string, unknown>)[key], value));
  }
  return false;
}

function parseEmbeddedJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const candidates = [body.indexOf("\n["), body.indexOf("\n{"), body.indexOf("["), body.indexOf("{")]
      .filter((index) => index >= 0)
      .map((index) => body.slice(index).trimStart());
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        continue;
      }
    }
    throw new Error("Unable to parse embedded JSON");
  }
}

function matchesJson(body: string, expected: unknown): boolean {
  if (expected === undefined) return true;
  try {
    return deepIncludes(parseEmbeddedJson(body), expected);
  } catch {
    return false;
  }
}

function describeLocalCheck(check: LocalVerifyCheckConfig): string {
  return check.name
    ?? (check.type === "worker"
      ? `worker: ${check.worker}${check.endpoint ? `#${check.endpoint}` : ` ${check.path ?? "/"}`}`
      : check.type === "cron"
        ? `cron: ${check.worker}`
        : check.type === "queue"
          ? `queue: ${check.queue}`
          : `${check.type}: ${check.database}`);
}

export async function verifyLocal(deps: LocalVerifyDeps): Promise<LocalVerifyResult> {
  const { rootDir, config } = deps;
  const wrangler = deps.wrangler ?? createWranglerRunner();
  const callWorkerFn = deps.callWorkerFn ?? callWorker;
  const sendQueueMessageFn = deps.sendQueueMessageFn ?? sendQueueMessage;
  const triggerCronFn = deps.triggerCronFn ?? triggerCron;
  const resolvePlannedWorkerPortFn = deps.resolvePlannedWorkerPortFn ?? resolvePlannedWorkerPort;
  const executeLocalD1Fn = deps.executeLocalD1Fn ?? executeLocalD1;
  const checks: VerifyCheck[] = [];
  const configuredPack = deps.pack ? config.verifyLocal?.packs?.[deps.pack] : undefined;
  if (deps.pack && !configuredPack) {
    return {
      passed: false,
      pack: deps.pack,
      checks: [{
        name: "Local verify pack",
        passed: false,
        details: `Unknown verifyLocal pack "${deps.pack}"`,
      }],
    };
  }
  const localChecks = configuredPack?.checks ?? config.verifyLocal?.checks ?? [];

  if (localChecks.length === 0) {
    return {
      passed: false,
      checks: [{
        name: "Local verify config",
        passed: false,
        details: "No verifyLocal.checks configured.",
      }],
    };
  }

  for (const check of localChecks) {
    const name = describeLocalCheck(check);
    try {
      if (check.type === "worker") {
        const fixture = check.fixture ? getWorkerFixture(config, check.fixture) : undefined;
        if (check.fixture && !fixture) {
          throw new Error(`Unknown worker fixture "${check.fixture}"`);
        }
        const result = await callWorkerFn(config, rootDir, {
          worker: fixture?.worker ?? check.worker,
          endpoint: check.endpoint ?? fixture?.endpoint,
          path: check.path ?? fixture?.path,
          method: check.method ?? fixture?.method,
          query: { ...(fixture?.query ?? {}), ...(check.query ?? {}) },
          headers: { ...(fixture?.headers ?? {}), ...(check.headers ?? {}) },
          body: check.body ?? fixture?.body,
        });
        const expectedStatus = check.expectStatus ?? 200;
        checks.push({
          name,
          passed:
            result.status === expectedStatus
            && includesAll(result.body, check.expectBodyIncludes)
            && matchesHeaders(result.headers, check.expectHeaders)
            && matchesJson(result.body, check.expectJsonIncludes),
          details: `${result.status} ${result.target.url}`,
        });
        continue;
      }

      if (check.type === "cron") {
        const port = await resolvePlannedWorkerPortFn(config, rootDir, check.worker);
        const result = await triggerCronFn({ port, cron: check.cron, time: check.time });
        const expectedStatus = check.expectStatus ?? 200;
        checks.push({
          name,
          passed:
            result.status === expectedStatus
            && includesAll(result.body, check.expectBodyIncludes)
            && matchesJson(result.body, check.expectJsonIncludes),
          details: `${result.status} ${result.url}`,
        });
        continue;
      }

      if (check.type === "queue") {
        const fixture = check.fixture ? getQueueFixture(config, check.fixture) : undefined;
        if (check.fixture && !fixture) {
          throw new Error(`Unknown queue fixture "${check.fixture}"`);
        }
        const payload = check.payload ?? fixture?.payload;
        if (!payload) {
          throw new Error(`Queue check "${name}" requires payload or fixture.`);
        }
        const result = await sendQueueMessageFn(config, rootDir, {
          queue: fixture?.queue ?? check.queue,
          payload,
          worker: check.worker ?? fixture?.worker,
        });
        const expectedStatus = check.expectStatus ?? 200;
        checks.push({
          name,
          passed:
            result.status === expectedStatus
            && includesAll(result.body, check.expectBodyIncludes)
            && matchesJson(result.body, check.expectJsonIncludes),
          details: `${result.status} ${result.target.url}`,
        });
        continue;
      }

      if (check.type === "d1") {
        const fixture = check.fixture ? getD1Fixture(config, check.fixture) : undefined;
        if (check.fixture && !fixture) {
          throw new Error(`Unknown D1 fixture "${check.fixture}"`);
        }
        const result = executeLocalD1Fn(config, rootDir, wrangler, {
          database: fixture?.database ?? check.database,
          worker: check.worker ?? fixture?.worker,
          sql: check.sql ?? fixture?.sql,
          file: check.file ?? fixture?.file,
        });
        checks.push({
          name,
          passed:
            includesAll(result.output, check.expectTextIncludes)
            && matchesJson(result.output, check.expectJsonIncludes),
          details: result.target.workerPath,
        });
        continue;
      }

      if (check.type === "d1Seed" || check.type === "d1Reset") {
        const fixture = check.fixture ? getD1Fixture(config, check.fixture) : undefined;
        if (check.fixture && !fixture) {
          throw new Error(`Unknown D1 fixture "${check.fixture}"`);
        }
        const configuredFile = check.type === "d1Seed"
          ? config.dev?.d1?.[check.database]?.seedFile
          : config.dev?.d1?.[check.database]?.resetFile;
        const file = check.file ?? fixture?.file ?? configuredFile;
        if (!file) {
          throw new Error(`No file configured for ${check.type}.`);
        }
        const result = executeLocalD1Fn(config, rootDir, wrangler, {
          database: fixture?.database ?? check.database,
          worker: check.worker ?? fixture?.worker,
          file,
        });
        checks.push({
          name,
          passed: includesAll(result.output, check.expectTextIncludes),
          details: result.target.workerPath,
        });
      }
    } catch (error) {
      checks.push({
        name,
        passed: false,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
    pack: deps.pack,
  };
}
