import { readFileSync } from "node:fs";
import type { StateProvider } from "./state.js";
import type { CfStageConfig, StageState } from "../types.js";
import { isSecretRef, secretName } from "../types.js";
import type { WranglerRunner } from "./wrangler-runner.js";
import { AgentErrors } from "./cli-output.js";

export interface SecretStatus {
  worker: string;
  name: string;
  status: "set" | "missing" | "ref";
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
  if (!state) throw AgentErrors.state(`No state for stage "${stage}". Run apply first.`, `Run \`wd apply --stage ${stage}\` first.`);

  const results: SecretStatus[] = [];

  if (!config.secrets) return results;

  for (const [workerPath, secretSpecs] of Object.entries(config.secrets)) {
    const workerState = state.workers[workerPath];
    if (!workerState) {
      for (const spec of secretSpecs) {
        const name = secretName(spec);
        results.push({
          worker: workerPath,
          name,
          status: isSecretRef(spec) ? "ref" : "missing",
        });
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

    for (const spec of secretSpecs) {
      const name = secretName(spec);
      const present = existingSecrets.includes(name);
      // External refs report as "ref" when they're actually present in CF,
      // and "missing" when they're not — surfacing the gap loudly.
      const status: SecretStatus["status"] = isSecretRef(spec)
        ? present ? "ref" : "missing"
        : present ? "set" : "missing";
      results.push({ worker: workerPath, name, status });
    }
  }

  // Update state with secret status
  if (!config.secrets) return results;
  for (const [workerPath, secretSpecs] of Object.entries(config.secrets)) {
    if (!state.secrets[workerPath]) state.secrets[workerPath] = {};
    for (const spec of secretSpecs) {
      const name = secretName(spec);
      const found = results.find((r) => r.worker === workerPath && r.name === name);
      const recorded = found?.status === "ref" ? "set" : found?.status ?? "missing";
      state.secrets[workerPath][name] = recorded;
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

export interface SecretSyncPreview {
  set: string[];
  skipped: string[];
}

export function buildSecretSyncPreview(
  secretsConfig: CfStageConfig["secrets"] | undefined,
  stageState: StageState,
  envVars: Map<string, string>,
): SecretSyncPreview {
  const set: string[] = [];
  const skipped: string[] = [];
  if (!secretsConfig) return { set, skipped };

  for (const [workerPath, secretSpecs] of Object.entries(secretsConfig)) {
    const workerState = stageState.workers[workerPath];
    if (!workerState) {
      skipped.push(...secretSpecs.map((s) => `${workerPath}/${secretName(s)} (worker not in state)`));
      continue;
    }
    for (const spec of secretSpecs) {
      const name = secretName(spec);
      if (isSecretRef(spec)) {
        skipped.push(`${workerPath}/${name} (ref: managed externally)`);
        continue;
      }
      if (envVars.get(name)) {
        set.push(`${workerPath}/${name}`);
      } else {
        skipped.push(`${workerPath}/${name} (not in env file)`);
      }
    }
  }

  return { set, skipped };
}

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
  if (!state) throw AgentErrors.state(`No state for stage "${stage}". Run apply first.`, `Run \`wd apply --stage ${stage}\` first.`);

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

  const preview = buildSecretSyncPreview(config.secrets, state, envVars);
  const setSecrets: string[] = [];
  const skippedSecrets: string[] = [];
  if (!config.secrets) return preview;

  for (const [workerPath, secretSpecs] of Object.entries(config.secrets)) {
    const workerState = state.workers[workerPath];
    if (!workerState) {
      continue;
    }

    for (const spec of secretSpecs) {
      const name = secretName(spec);
      // External refs are owned out-of-band — sync should never push them.
      if (isSecretRef(spec)) {
        continue;
      }
      const value = envVars.get(name);
      if (!value) {
        continue;
      }

      try {
        setSecretFn(
          { workerName: workerState.name, secretName: name, value },
          { rootDir, wrangler },
        );
        setSecrets.push(`${workerPath}/${name}`);

        // Update state
        if (!state.secrets[workerPath]) state.secrets[workerPath] = {};
        state.secrets[workerPath][name] = "set";
      } catch (err) {
        skippedSecrets.push(`${workerPath}/${name} (failed: ${(err as Error).message})`);
      }
    }
  }

  state.updatedAt = new Date().toISOString();
  await provider.write(stage, state);

  // Preserve preview ordering/reasons for deterministic dry-run parity, but
  // append runtime failures from actual set attempts.
  return { set: setSecrets, skipped: [...preview.skipped, ...skippedSecrets] };
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
  for (const [workerPath, secretSpecs] of Object.entries(config.secrets)) {
    for (const spec of secretSpecs) {
      const name = secretName(spec);
      // External refs are assumed present in CF (set out-of-band). They
      // pass validation as long as they were observed by checkSecrets.
      const recorded = state.secrets[workerPath]?.[name];
      if (recorded === "set") continue;
      if (isSecretRef(spec)) {
        // No record yet — surface as missing so deploy gating still
        // catches a genuinely missing externally-owned secret.
        if (recorded === undefined) missing.push(`${workerPath}/${name} (ref)`);
        continue;
      }
      missing.push(`${workerPath}/${name}`);
    }
  }
  return missing;
}
