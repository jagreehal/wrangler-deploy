import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CfStageConfig } from "../types.js";
import type { StateProvider } from "./state.js";

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
    const isActive = resource.observed.status === "active";
    checks.push({
      name: `Resource: ${resource.desired.name}`,
      passed: isActive,
      details: isActive ? undefined : `Status: ${resource.observed.status}`,
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
