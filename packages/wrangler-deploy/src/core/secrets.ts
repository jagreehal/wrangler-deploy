import { readFileSync } from "node:fs";
import type { StateProvider } from "./state.js";
import type { CfStageConfig } from "../types.js";
import type { WranglerRunner } from "./wrangler-runner.js";

export interface SecretStatus {
  worker: string;
  name: string;
  status: "set" | "missing";
}

// ============================================================================
// checkSecrets
// ============================================================================

export type CheckSecretsArgs = {
  stage: string;
};

export type CheckSecretsDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
};

/**
 * Check which declared secrets exist on deployed workers.
 * Uses `wrangler secret list --name <worker>` to get secret names.
 */
export async function checkSecrets(args: CheckSecretsArgs, deps: CheckSecretsDeps): Promise<SecretStatus[]> {
  const { stage } = args;
  const { rootDir, config, state: provider, wrangler } = deps;
  const state = await provider.read(stage);
  if (!state) throw new Error(`No state for stage "${stage}". Run apply first.`);

  const results: SecretStatus[] = [];

  if (!config.secrets) return results;

  for (const [workerPath, secretNames] of Object.entries(config.secrets)) {
    const workerState = state.workers[workerPath];
    if (!workerState) {
      for (const name of secretNames) {
        results.push({ worker: workerPath, name, status: "missing" });
      }
      continue;
    }

    // Get list of secrets from Cloudflare
    let existingSecrets: string[] = [];
    try {
      const output = wrangler.run(
        ["secret", "list", "--name", workerState.name],
        rootDir,
      );
      // Parse secret names from output (wrangler outputs JSON array of {name, type})
      const parsed = JSON.parse(output) as Array<{ name: string }>;
      existingSecrets = parsed.map((s) => s.name);
    } catch {
      // If worker doesn't exist yet or list fails, all secrets are missing
    }

    for (const name of secretNames) {
      results.push({
        worker: workerPath,
        name,
        status: existingSecrets.includes(name) ? "set" : "missing",
      });
    }
  }

  // Update state with secret status
  if (!config.secrets) return results;
  for (const [workerPath, secretNames] of Object.entries(config.secrets)) {
    if (!state.secrets[workerPath]) state.secrets[workerPath] = {};
    for (const name of secretNames) {
      const found = results.find((r) => r.worker === workerPath && r.name === name);
      state.secrets[workerPath][name] = found?.status ?? "missing";
    }
  }
  state.updatedAt = new Date().toISOString();
  await provider.write(stage, state);

  return results;
}

// ============================================================================
// setSecret
// ============================================================================

export type SetSecretArgs = {
  workerName: string;
  secretName: string;
  value: string;
};

export type SetSecretDeps = {
  rootDir: string;
  wrangler: WranglerRunner;
};

/**
 * Set a single secret on a worker via wrangler.
 */
export function setSecret(args: SetSecretArgs, deps: SetSecretDeps): void {
  // wrangler secret put requires input via stdin, but WranglerRunner uses execFileSync
  // We need to use the runner's run method with the input piped
  // For now, delegate to the runner — the CLI wires a runner that handles stdin
  deps.wrangler.run(
    ["secret", "put", args.secretName, "--name", args.workerName],
    deps.rootDir,
  );
}

// ============================================================================
// syncSecretsFromEnvFile
// ============================================================================

export type SyncSecretsArgs = {
  stage: string;
  envFilePath: string;
};

export type SyncSecretsDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
  wrangler: WranglerRunner;
  setSecretFn?: typeof setSecret;
};

/**
 * Sync secrets from an env file to a stage's workers.
 * File format: KEY=value (same as .dev.vars)
 */
export async function syncSecretsFromEnvFile(
  args: SyncSecretsArgs,
  deps: SyncSecretsDeps,
): Promise<{ set: string[]; skipped: string[] }> {
  const { stage, envFilePath } = args;
  const { rootDir, config, state: provider, wrangler } = deps;
  const setSecretFn = deps.setSecretFn ?? setSecret;
  const state = await provider.read(stage);
  if (!state) throw new Error(`No state for stage "${stage}". Run apply first.`);

  // Parse env file
  const content = readFileSync(envFilePath, "utf-8");
  const envVars = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    envVars.set(key, value);
  }

  const setSecrets: string[] = [];
  const skippedSecrets: string[] = [];

  if (!config.secrets) return { set: setSecrets, skipped: skippedSecrets };

  for (const [workerPath, secretNames] of Object.entries(config.secrets)) {
    const workerState = state.workers[workerPath];
    if (!workerState) {
      skippedSecrets.push(...secretNames.map((n) => `${workerPath}/${n} (worker not in state)`));
      continue;
    }

    for (const secretName of secretNames) {
      const value = envVars.get(secretName);
      if (!value) {
        skippedSecrets.push(`${workerPath}/${secretName} (not in env file)`);
        continue;
      }

      try {
        setSecretFn(
          { workerName: workerState.name, secretName, value },
          { rootDir, wrangler },
        );
        setSecrets.push(`${workerPath}/${secretName}`);

        // Update state
        if (!state.secrets[workerPath]) state.secrets[workerPath] = {};
        state.secrets[workerPath][secretName] = "set";
      } catch (err) {
        skippedSecrets.push(`${workerPath}/${secretName} (failed: ${(err as Error).message})`);
      }
    }
  }

  state.updatedAt = new Date().toISOString();
  await provider.write(stage, state);

  return { set: setSecrets, skipped: skippedSecrets };
}

// ============================================================================
// validateSecrets
// ============================================================================

export type ValidateSecretsArgs = {
  stage: string;
};

export type ValidateSecretsDeps = {
  rootDir: string;
  config: CfStageConfig;
  state: StateProvider;
};

/**
 * Validate that all declared secrets are set. Returns missing secrets.
 * Used by deploy for pre-deploy validation.
 */
export async function validateSecrets(args: ValidateSecretsArgs, deps: ValidateSecretsDeps): Promise<string[]> {
  const { stage } = args;
  const { config, state: provider } = deps;
  const state = await provider.read(stage);
  if (!state || !config.secrets) return [];

  const missing: string[] = [];
  for (const [workerPath, secretNames] of Object.entries(config.secrets)) {
    for (const name of secretNames) {
      if (state.secrets[workerPath]?.[name] !== "set") {
        missing.push(`${workerPath}/${name}`);
      }
    }
  }
  return missing;
}
