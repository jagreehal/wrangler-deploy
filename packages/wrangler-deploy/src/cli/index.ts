#!/usr/bin/env node

import { resolve, join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createWranglerRunner } from "../core/wrangler-runner.js";
import { resolveStateProvider } from "../core/state.js";
import { apply, plan } from "../core/apply.js";
import { deploy } from "../core/deploy.js";
import { destroy } from "../core/destroy.js";
import { verify } from "../core/verify.js";
import {
  checkSecrets,
  setSecret,
  syncSecretsFromEnvFile,
  validateSecrets,
} from "../core/secrets.js";
import { gc } from "../core/gc.js";
import { generateConfig } from "../core/init.js";
import { introspect } from "../core/introspect.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

async function loadConfig(rootDir: string) {
  const configPath = resolve(rootDir, "wrangler-deploy.config.ts");
  if (!existsSync(configPath)) {
    // Try .js
    const jsPath = resolve(rootDir, "wrangler-deploy.config.js");
    if (!existsSync(jsPath)) {
      throw new Error(
        "No wrangler-deploy.config.ts or wrangler-deploy.config.js found in the current directory.",
      );
    }
    // eslint-disable-next-line no-restricted-syntax
    const mod = await import(jsPath);
    return mod.default;
  }

  // For TS config, use dynamic import (works with tsx, bun, ts-node)
  // eslint-disable-next-line no-restricted-syntax
  const mod = await import(configPath);
  return mod.default;
}

async function main() {
  const rootDir = process.cwd();

  if (!command || command === "help" || command === "--help") {
    console.log(`
  wrangler-deploy — Wrangler-native environment orchestration

  Commands:
    init        Scan local wrangler configs and generate wrangler-deploy.config.ts
    introspect  Scan live Cloudflare account and generate config from existing resources
    plan        Show what would be created/changed
    apply    Provision resources and generate configs
    deploy   Deploy workers using rendered configs
    destroy  Tear down all resources for a stage
    gc       Garbage collect expired stages past their TTL
    status   Show stage status
    secrets  Check which declared secrets are set/missing
    verify   Post-deploy coherence check

  Secrets sub-commands:
    secrets --stage <name>                           Check secret status
    secrets set --stage <name>                       Interactively set missing secrets
    secrets sync --to <stage> --from-env-file <path> Bulk set from .dev.vars file

  Options:
    --stage <name>       Stage name (required)
    --database-url <url> Postgres URL (required for Hyperdrive on first apply)
    --force              Force destructive operations on protected stages
    --verify             Run verification after deploy

  Examples:
    wrangler-deploy init
    wrangler-deploy plan --stage staging
    wrangler-deploy apply --stage staging --database-url "postgresql://..."
    wrangler-deploy deploy --stage staging
    wrangler-deploy secrets --stage staging
    wrangler-deploy secrets set --stage staging
    wrangler-deploy secrets sync --to staging --from-env-file .dev.vars
    wrangler-deploy destroy --stage pr-123
    wrangler-deploy status
`);
    return;
  }

  const stage = getFlag("stage");

  switch (command) {
    case "init": {
      const output = generateConfig(rootDir);
      const outPath = join(rootDir, "wrangler-deploy.config.ts");
      if (existsSync(outPath)) {
        console.error(
          `  wrangler-deploy.config.ts already exists. Delete it first or use a different directory.`,
        );
        process.exit(1);
      }
      writeFileSync(outPath, output);
      console.log(`\n  Generated wrangler-deploy.config.ts from ${rootDir}\n`);
      console.log(`  Review the file and adjust:\n`);
      console.log(`    1. deployOrder (set correct dependency order)`);
      console.log(`    2. Resource logical names`);
      console.log(`    3. Secrets declarations\n`);
      break;
    }

    case "introspect": {
      const wrangler = createWranglerRunner();
      const filter = getFlag("filter");
      const dryRun = hasFlag("dry-run");
      const result = await introspect(
        { filter, dryRun },
        { rootDir, wrangler },
      );

      if (dryRun) {
        console.log(`\n  Dry run — config not written.\n`);
        console.log(result.configSource);
      } else {
        const outPath = join(rootDir, "wrangler-deploy.config.ts");
        if (existsSync(outPath)) {
          console.error(
            `\n  wrangler-deploy.config.ts already exists. Delete it first or use --dry-run to preview.\n`,
          );
          process.exit(1);
        }
        writeFileSync(outPath, result.configSource);
        console.log(`\n  Generated wrangler-deploy.config.ts from live account.\n`);
        console.log(`  Review the file and adjust:\n`);
        console.log(`    1. Worker paths (replace names with local directory paths)`);
        console.log(`    2. Resource logical names`);
        console.log(`    3. Stage protection rules\n`);
      }
      break;
    }

    case "plan": {
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state);
      const result = await plan({ stage }, { rootDir, config, state: stateProvider });

      console.log(`\n  wrangler-deploy plan --stage ${stage}\n`);
      for (const item of result.items) {
        const symbol =
          item.action === "create"
            ? "+"
            : item.action === "in-sync"
              ? "="
              : item.action === "drifted"
                ? "~"
                : item.action === "orphaned"
                  ? "!"
                  : "-";
        console.log(`  ${symbol} ${item.name} (${item.type}) ${item.action}`);
        if (item.details) console.log(`    ${item.details}`);
      }

      const created = result.items.filter((i) => i.action === "create").length;
      const synced = result.items.filter((i) => i.action === "in-sync").length;
      const drifted = result.items.filter((i) => i.action === "drifted").length;
      const orphaned = result.items.filter((i) => i.action === "orphaned").length;
      console.log(
        `\n  ${created} to create, ${synced} in sync, ${drifted} drifted, ${orphaned} orphaned\n`,
      );
      break;
    }

    case "apply": {
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state);
      await apply(
        { stage, databaseUrl: getFlag("database-url") },
        { rootDir, config, state: stateProvider, wrangler },
      );
      break;
    }

    case "secrets": {
      const subCommand = args[1]; // set, sync, or undefined (defaults to check)

      if (subCommand === "sync") {
        // wrangler-deploy secrets sync --to <stage> --from-env-file <path>
        const toStage = getFlag("to");
        const envFile = getFlag("from-env-file");
        if (!toStage) throw new Error("--to is required for secrets sync");
        if (!envFile) throw new Error("--from-env-file is required for secrets sync");
        const config = await loadConfig(rootDir);
        const wrangler = createWranglerRunner();
        const stateProvider = resolveStateProvider(rootDir, config.state);
        const result = await syncSecretsFromEnvFile(
          { stage: toStage, envFilePath: resolve(rootDir, envFile) },
          { rootDir, config, state: stateProvider, wrangler },
        );

        console.log(`\n  wrangler-deploy secrets sync --to ${toStage}\n`);
        for (const s of result.set) console.log(`  + ${s}`);
        for (const s of result.skipped) console.log(`  - ${s} (skipped)`);
        console.log(`\n  ${result.set.length} set, ${result.skipped.length} skipped\n`);
        break;
      }

      if (subCommand === "set") {
        // wrangler-deploy secrets set --stage <name>
        if (!stage) throw new Error("--stage is required");
        const config = await loadConfig(rootDir);
        const wrangler = createWranglerRunner();
        const stateProvider = resolveStateProvider(rootDir, config.state);

        const statuses = await checkSecrets(
          { stage },
          { rootDir, config, state: stateProvider, wrangler },
        );
        const missing = statuses.filter((s) => s.status === "missing");

        if (missing.length === 0) {
          console.log(`\n  All secrets are set for stage "${stage}".\n`);
          break;
        }

        console.log(`\n  Setting ${missing.length} missing secret(s) for stage "${stage}":\n`);

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

        const stageState = await stateProvider.read(stage);
        for (const s of missing) {
          const wName = stageState?.workers[s.worker]?.name;
          if (!wName) {
            console.log(`  Skipping ${s.worker}/${s.name} (worker not deployed)`);
            continue;
          }
          const value = await question(`  ${s.worker}/${s.name}: `);
          if (value) {
            setSecret({ workerName: wName, secretName: s.name, value }, { rootDir, wrangler });
            console.log(`    set\n`);
          }
        }
        rl.close();
        break;
      }

      // Default: wrangler-deploy secrets --stage <name> (check)
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state);
      const statuses = await checkSecrets(
        { stage },
        { rootDir, config, state: stateProvider, wrangler },
      );

      console.log(`\n  wrangler-deploy secrets --stage ${stage}\n`);

      let currentWorker = "";
      for (const s of statuses) {
        if (s.worker !== currentWorker) {
          currentWorker = s.worker;
          console.log(`  ${currentWorker}:`);
        }
        const icon = s.status === "set" ? "+" : "x";
        console.log(`    ${icon} ${s.name}: ${s.status}`);
      }

      const missingCount = statuses.filter((s) => s.status === "missing");
      if (missingCount.length > 0) {
        console.log(
          `\n  ${missingCount.length} missing — run "wrangler-deploy secrets set --stage ${stage}" to fix\n`,
        );
      } else {
        console.log(`\n  All secrets set.\n`);
      }
      break;
    }

    case "deploy": {
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state);
      await deploy(
        { stage, verify: hasFlag("verify") },
        {
          rootDir,
          config,
          state: stateProvider,
          wrangler,
          validateSecretsFn: validateSecrets,
          verifyFn: verify,
        },
      );
      break;
    }

    case "destroy": {
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state);
      await destroy(
        { stage, force: hasFlag("force") },
        { rootDir, config, state: stateProvider, wrangler },
      );
      break;
    }

    case "verify": {
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state);
      const result = await verify({ stage }, { rootDir, config, state: stateProvider });

      console.log(`\n  wrangler-deploy verify --stage ${stage}\n`);
      for (const check of result.checks) {
        const icon = check.passed ? "+" : "x";
        console.log(`  ${icon} ${check.name}${check.details ? ` — ${check.details}` : ""}`);
      }

      const passed = result.checks.filter((c) => c.passed).length;
      const failed = result.checks.filter((c) => !c.passed).length;
      console.log(`\n  ${passed} passed, ${failed} failed\n`);

      if (!result.passed) process.exit(1);
      break;
    }

    case "gc": {
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state);
      const result = await gc({}, { rootDir, config, state: stateProvider, wrangler });

      console.log(`\n  wrangler-deploy gc\n`);
      for (const s of result.destroyed) console.log(`  - ${s} (destroyed — TTL expired)`);
      for (const s of result.kept) console.log(`  = ${s} (kept — TTL not expired)`);
      for (const s of result.protected) console.log(`  # ${s} (protected)`);
      console.log(
        `\n  ${result.destroyed.length} destroyed, ${result.kept.length} kept, ${result.protected.length} protected\n`,
      );
      break;
    }

    case "status": {
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state);
      if (stage) {
        const stageState = await stateProvider.read(stage);
        if (!stageState) {
          console.log(`  No state found for stage "${stage}".`);
          return;
        }
        console.log(`\n  Stage: ${stage}`);
        console.log(`  Created: ${stageState.createdAt}`);
        console.log(`  Updated: ${stageState.updatedAt}`);
        console.log(`\n  Resources:`);
        for (const [_name, r] of Object.entries(stageState.resources)) {
          console.log(
            `    ${r.observed.status === "active" ? "+" : "-"} ${r.desired.name} (${r.type}) — ${r.observed.status}`,
          );
        }
        console.log(`\n  Workers:`);
        for (const [_path, w] of Object.entries(stageState.workers)) {
          console.log(`    ${w.name}${w.url ? ` — ${w.url}` : ""}`);
        }
        console.log("");
      } else {
        const stages = await stateProvider.list();
        if (stages.length === 0) {
          console.log("  No stages found.");
          return;
        }
        console.log(`\n  Stages:\n`);
        for (const s of stages) {
          const stageState = await stateProvider.read(s);
          if (!stageState) continue;
          const resourceCount = Object.keys(stageState.resources).length;
          const workerCount = Object.keys(stageState.workers).length;
          console.log(`    ${s}  ${workerCount} workers  ${resourceCount} resources`);
        }
        console.log("");
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run "wrangler-deploy help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  Error: ${(err as Error).message}\n`);
  process.exit(1);
});
