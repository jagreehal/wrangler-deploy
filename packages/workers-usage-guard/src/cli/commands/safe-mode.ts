import type { ParsedArgs } from "../parse.js";
import { boolFlag } from "../parse.js";
import { loadConfig, listNotificationSecrets, SIGNING_KEY_ENV } from "../config.js";

export const summary = "Non-destructive risk preview before deploy or policy changes";

export const help = `
wug safe-mode [--json]

Runs a non-destructive safety simulation:
- required secret/env presence checks
- kill-switch blast-radius preview (killable vs protected scripts)
- threshold sanity warnings

Exits non-zero if blockers are found.
`;

type WorkerRisk = {
  accountId: string;
  scriptName: string;
  protected: boolean;
  warnings: string[];
};

export async function run(args: ParsedArgs): Promise<number> {
  const config = loadConfig({ cwd: process.cwd() });
  const accounts = config.accounts ?? [];
  const requiredSecrets = ["CLOUDFLARE_API_TOKEN", SIGNING_KEY_ENV, ...listNotificationSecrets(config)];
  const uniqueSecrets = Array.from(new Set(requiredSecrets));
  const missingSecrets = uniqueSecrets.filter((s) => !process.env[s] || process.env[s] === "");

  const workerRisks: WorkerRisk[] = [];
  for (const account of accounts) {
    const globalProtected = new Set(account.globalProtected ?? []);
    for (const worker of account.workers) {
      const warnings: string[] = [];
      const thresholds = worker.thresholds ?? {};
      if (typeof thresholds.requests === "number" && thresholds.requests < 1000) {
        warnings.push(`very low requests threshold (${thresholds.requests})`);
      }
      if (typeof thresholds.cpuMs === "number" && thresholds.cpuMs < 1000) {
        warnings.push(`very low cpuMs threshold (${thresholds.cpuMs})`);
      }
      if (typeof thresholds.costUsd === "number" && thresholds.costUsd < 1) {
        warnings.push(`very low costUsd threshold (${thresholds.costUsd})`);
      }
      if (worker.forecast === true && (worker.forecastLookaheadSeconds ?? 600) < 300) {
        warnings.push(`forecastLookaheadSeconds < 300 may create noisy triggers`);
      }
      workerRisks.push({
        accountId: account.accountId,
        scriptName: worker.scriptName,
        protected: worker.protected === true || globalProtected.has(worker.scriptName),
        warnings,
      });
    }
  }

  const killable = workerRisks.filter((w) => !w.protected);
  const warned = workerRisks.filter((w) => w.warnings.length > 0);
  const blockers: string[] = [];
  if (accounts.length === 0) blockers.push("no accounts configured");
  if (missingSecrets.length > 0) blockers.push(`missing required secrets: ${missingSecrets.join(", ")}`);

  const result = {
    ok: blockers.length === 0,
    blockers,
    summary: {
      accounts: accounts.length,
      workers: workerRisks.length,
      killableWorkers: killable.length,
      protectedWorkers: workerRisks.length - killable.length,
      warningWorkers: warned.length,
    },
    missingSecrets,
    killableWorkers: killable.map((w) => `${w.accountId}:${w.scriptName}`),
    warnings: warned.map((w) => ({
      worker: `${w.accountId}:${w.scriptName}`,
      warnings: w.warnings,
    })),
  };

  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`accounts: ${result.summary.accounts}, workers: ${result.summary.workers}`);
    console.log(`killable: ${result.summary.killableWorkers}, protected: ${result.summary.protectedWorkers}`);
    console.log(`warning workers: ${result.summary.warningWorkers}`);
    if (result.missingSecrets.length > 0) {
      console.log(`missing secrets: ${result.missingSecrets.join(", ")}`);
    }
    if (result.killableWorkers.length > 0) {
      console.log(`killable workers: ${result.killableWorkers.join(", ")}`);
    }
    for (const w of result.warnings) {
      console.log(`${w.worker}: ${w.warnings.join("; ")}`);
    }
  }
  return result.ok ? 0 : 1;
}

