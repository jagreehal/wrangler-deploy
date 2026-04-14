#!/usr/bin/env node

import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createWranglerRunner } from "../core/wrangler-runner.js";
import { resolveStateProvider } from "../core/state.js";
import {
  clearProjectContext,
  getProjectContextValue,
  loadProjectContext,
  loadProjectContextDetails,
  unsetProjectContext,
  writeProjectContext,
} from "../core/project-context.js";
import { clearActiveDevState, resolveDevLogDir, writeActiveDevState } from "../core/dev-runtime-state.js";
import { apply, plan } from "../core/apply.js";
import { deploy } from "../core/deploy.js";
import { destroy } from "../core/destroy.js";
import { verify, verifyLocal } from "../core/verify.js";
import {
  checkSecrets,
  setSecret,
  syncSecretsFromEnvFile,
  validateSecrets,
} from "../core/secrets.js";
import { gc } from "../core/gc.js";
import { generateConfig } from "../core/init.js";
import { createViteStarter } from "../core/create.js";
import { introspect } from "../core/introspect.js";
import { buildRichGraph } from "../core/graph-model.js";
import { resolveDeployOrder } from "../core/graph.js";
import { renderAscii, renderMermaid, renderDot } from "../core/renderers/index.js";
import { analyzeImpact } from "../core/impact.js";
import { buildDevPlan, startDev } from "../core/dev.js";
import { generateGitHubWorkflow } from "../core/ci/workflow-gen.js";
import { detectCiEnvironment } from "../core/ci/detect.js";
import { createGitHubProvider } from "../core/ci/github.js";
import { buildPrComment } from "../core/ci/comment.js";
import { postCheckRun } from "../core/ci/check.js";
import { diffStages } from "../core/stage-diff.js";
import { runDoctor } from "../core/doctor.js";
import { validateConfig } from "../core/validate-config.js";
import { generateCompletions } from "../core/completions.js";
import {
  callWorker,
  executeLocalD1,
  getD1Database,
  getQueueRoute,
  listD1Databases,
  listQueueRoutes,
  listWorkerRoutes,
  parseInterval,
  readDevLogSnapshot,
  replayQueueMessages,
  readQueueTailSnapshot,
  resolvePlannedWorkerPort,
  runDevDoctor,
  sendQueueMessage,
  triggerCron,
} from "../core/runtime.js";
import { logFilePathForTarget } from "../core/dev-logs.js";
import { readWranglerConfig } from "../core/wrangler.js";
import { startDevUi } from "../core/dev-ui.js";
import { listSnapshots, loadSnapshot, saveSnapshot } from "../core/snapshots.js";
import {
  getD1Fixture,
  getQueueFixture,
  getWorkerFixture,
  listFixtures,
} from "../core/fixtures.js";
import { cliManifest } from "../core/cli-manifest.js";
import {
  formatCliError,
  isDryRun,
  parseOutputFields,
  parseOutputFormat,
  printJson,
  setJsonOutputOptions,
} from "../core/cli-output.js";
import type { ProjectContext } from "../types.js";

const args = process.argv.slice(2);
const command = args[0];
const outputFormat = parseOutputFormat(args);
setJsonOutputOptions({
  fields: parseOutputFields(args),
  ndjson: args.includes("--ndjson") || getFlag("format") === "ndjson",
});
const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function getFlags(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === `--${name}` && args[index + 1] !== undefined) {
      values.push(args[index + 1]!);
      index += 1;
    }
  }
  return values;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function parseKeyValueFlags(entries: string[], flagName: string): Record<string, string> {
  return Object.fromEntries(entries.map((entry) => {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      throw new Error(`Invalid --${flagName} value "${entry}". Use key=value.`);
    }
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

function resolveStatePassword(
  config: { statePassword?: string },
  projectContext: { statePassword?: string },
  override: string | undefined = getFlag("state-password"),
): string | undefined {
  return override ?? config.statePassword ?? projectContext.statePassword ?? process.env.WD_STATE_PASSWORD;
}

function wantsJsonOutput(): boolean {
  return outputFormat === "json";
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
  const projectContext = loadProjectContext(rootDir);
  const projectContextDetails = loadProjectContextDetails(rootDir);

  if (!command || command === "help" || command === "--help") {
    if (outputFormat === "json") {
      printJson(cliManifest);
      return;
    }

    console.log(`
  wrangler-deploy — Wrangler-native environment orchestration

  Commands:
    create      Scaffold a new starter project
    init        Scan local wrangler configs and generate wrangler-deploy.config.ts
    introspect  Scan live Cloudflare account and generate config from existing resources
    plan        Show what would be created/changed
    apply    Provision resources and generate configs
    deploy   Deploy workers using rendered configs
    destroy  Tear down all resources for a stage
    gc       Garbage collect expired stages past their TTL
    status   Show stage status
    secrets  Check which declared secrets are set/missing
    verify   Post-deploy coherence check or local runtime verification
    graph       [--stage <name>] [--format ascii|mermaid|dot|json]  Show topology
    impact      <worker-path>                                       Show dependency impact
    diff        <stage-a> <stage-b> [--format json]                 Compare stages
    schema      Emit the CLI manifest as JSON
    tools       Emit tool metadata derived from the manifest
    dev         [--stage <stage>] [--filter <worker>] [--fallback-stage <stage>] [--port <base>] [--session]  Start local dev
    dev doctor                                                      Validate local dev setup
    dev ui                                                          Start a local runtime dashboard
    snapshot list                                                   List saved local runtime snapshots
    snapshot save <name>                                            Save local state for later replay
    snapshot load <name>                                            Restore local state from a snapshot
    cron trigger <worker>                                           Trigger local scheduled handler
    cron loop <worker>                                              Re-trigger local scheduled handler on an interval
    logs       [worker]                                             Tail persisted logs from the active dev runtime
    worker call <worker>                                            Call a local worker by worker path
    worker routes [worker]                                          Show worker URLs and named local endpoints
    fixture list                                                    Show shared local fixtures
    d1 list                                                         Show D1 database topology
    d1 inspect <database>                                           Inspect one D1 database binding map
    d1 exec <database>                                              Run local wrangler d1 execute by logical DB name
    d1 seed <database>                                              Run a configured or explicit local seed SQL file
    d1 reset <database>                                             Run a configured or explicit local reset SQL file
    queue list                                                      Show queue producers/consumers
    queue inspect <queue>                                           Inspect one queue topology
    queue send <queue>                                              Send a local queue payload via a producer route
    queue replay <queue>                                            Replay a JSON array of queue payloads from a file
    queue tail <queue>                                              Tail consumer logs for a queue from the active dev runtime
    ci init     [--provider github] [--branch main]                 Generate CI workflow
    ci comment  --stage <name>                                      Post/update PR comment
    ci check    --stage <name>                                      Post GitHub check runs
    doctor                                                          Run diagnostic checks
    completions --shell zsh|bash|fish                               Generate shell completions
    context                                                         Show resolved project defaults
    context get <key>                                               Show one default value
    context set                                                     Update project defaults in .wdrc
    context unset                                                   Remove project default keys
    context clear                                                   Remove the project defaults file

  Secrets sub-commands:
    secrets --stage <name>                           Check secret status
    secrets set --stage <name>                       Interactively set missing secrets
    secrets sync --to <stage> --from-env-file <path> Bulk set from .dev.vars file

  Options:
    --stage <name>       Stage name (required)
    --database-url <url> Postgres URL (required for Hyperdrive on first apply)
    --account-id <id>    Cloudflare account ID override
    --force              Force destructive operations on protected stages
    --dry-run            Preview mutating actions without changing state
    --verify             Run verification after deploy
    --session            Run wrangler dev as a single multi-config local session
    --base-port <number> Base port for wd dev
    --fallback-stage <name> Fallback stage for wd dev filter read mode
    --persist-to <path>  Persist Miniflare state for session mode
    --filter <worker>    Filter wd dev to one worker
    --stage <name>       Render and use stage bindings directly for wd dev
    --pack <name>        Run a named verify-local pack
    --state-password <value>  Encrypt or decrypt project defaults and state
    --json-report        Print machine-readable JSON output
    --endpoint <name>     Named local endpoint for worker call
    --cron <expr>         Cron expression for local scheduled trigger
    --time <epoch>        Override scheduledTime in local scheduled trigger
    --every <interval>    Loop interval like 5s, 1m, or 500ms
    --path <route>        Override scheduled route (default: /cdn-cgi/handler/scheduled)
    --port <number>       Explicit local dev port for cron trigger
    --sql <statement>     Inline SQL for local D1 execution
    --grep <pattern>      Filter log output by regex pattern
    --method <verb>       HTTP method for worker call (default: GET)
    --query <k=v>         Query string pair for worker call (repeatable)
    --header <k=v>        Header for worker call (repeatable)
    --body <text>         Raw request body for worker call
    --body-file <path>    Read raw request body from a file for worker call
    --fixture <name>      Use a named local fixture from wrangler-deploy.config.ts
    --payload <json>      Inline JSON payload for queue send
    --payload-file <path> JSON payload file for queue send
    --worker <worker>     Explicit producer worker for queue send
    --watch               Repeat queue send on an interval
    --count <number>      Stop queue send watch after N sends
    --follow              Keep following queue tail output (default)
    --once                Print the current queue tail snapshot and exit
    --json                Emit machine-readable JSON for supported commands
    --format json         Emit machine-readable JSON for supported commands
    --fields <paths>      Filter JSON output to specific dot-paths
    --ndjson              Emit newline-delimited JSON for array outputs
    --key <name>          Key to read with wd context get

  Project defaults:
    .wdrc or .wdrc.json   Default stage, dev settings, database URL, and account ID

  Examples:
    wrangler-deploy init
    wrangler-deploy create vite my-app
    wrangler-deploy plan --stage staging
    wrangler-deploy apply --stage staging --database-url "postgresql://..."
    wrangler-deploy deploy --stage staging
    wrangler-deploy schema --json
    wrangler-deploy tools --json
    wrangler-deploy context --json
    wrangler-deploy context get stage
    wrangler-deploy context set --stage staging --account-id 1234...
    wrangler-deploy context unset --stage --account-id
    wrangler-deploy context clear
    wrangler-deploy secrets --stage staging
    wrangler-deploy secrets set --stage staging
    wrangler-deploy secrets sync --to staging --from-env-file .dev.vars
    wrangler-deploy destroy --stage pr-123
    wrangler-deploy status
`);
    return;
  }

  const stage = getFlag("stage") ?? projectContext.stage;

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

    case "create": {
      const template = args[1];
      if (template !== "vite") {
        throw new Error(`Unknown starter template "${template}". Available templates: vite.`);
      }

      const targetDir = getFlag("dir") ?? args[2] ?? "cloudflare-vite-app";
      const result = createViteStarter({
        targetDir,
        projectName: getFlag("name"),
        force: hasFlag("force"),
      });

      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }

      console.log(`\n  Created ${result.template} starter in ${result.targetDir}\n`);
      for (const file of result.files) {
        console.log(`  ✓ ${file}`);
      }
      console.log(`\n  Next:\n`);
      console.log(`    cd ${targetDir}`);
      console.log(`    pnpm install`);
      console.log(`    pnpm dev\n`);
      break;
    }

    case "introspect": {
      const wrangler = createWranglerRunner();
      const filter = getFlag("filter") ?? projectContext.filter;
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
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const result = await plan({ stage }, { rootDir, config, state: stateProvider });

      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }

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
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));

      if (isDryRun(args)) {
        const preview = await plan({ stage }, { rootDir, config, state: stateProvider });
        const result = {
          stage,
          dryRun: true,
          plan: preview,
          workers: config.workers,
        };
        if (wantsJsonOutput()) {
          printJson(result);
        } else {
          console.log(`\n  wrangler-deploy apply --stage ${stage} --dry-run\n`);
          for (const item of preview.items) {
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
          console.log(`\n  Preview only — no resources were changed.\n`);
        }
        break;
      }

      const result = await apply(
        { stage, databaseUrl: getFlag("database-url") ?? projectContext.databaseUrl },
        { rootDir, config, state: stateProvider, wrangler, logger: wantsJsonOutput() ? silentLogger : console },
      );
      if (wantsJsonOutput()) {
        printJson(result);
      }
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
        const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));

        if (isDryRun(args)) {
          const state = await stateProvider.read(toStage);
          if (!state) throw new Error(`No state for stage "${toStage}". Run apply first.`);
          const content = readFileSync(resolve(rootDir, envFile), "utf-8");
          const envVars = new Map<string, string>();
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) continue;
            envVars.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
          }

          const set: string[] = [];
          const skipped: string[] = [];
          if (config.secrets) {
            for (const [workerPath, secretNames] of Object.entries(config.secrets as Record<string, string[]>)) {
              const workerState = state.workers[workerPath];
              if (!workerState) {
                skipped.push(...secretNames.map((n) => `${workerPath}/${n} (worker not in state)`));
                continue;
              }
              for (const secretName of secretNames) {
                if (envVars.get(secretName)) {
                  set.push(`${workerPath}/${secretName}`);
                } else {
                  skipped.push(`${workerPath}/${secretName} (not in env file)`);
                }
              }
            }
          }

          const result = { stage: toStage, dryRun: true, set, skipped };
          if (wantsJsonOutput()) {
            printJson(result);
          } else {
            console.log(`\n  wrangler-deploy secrets sync --to ${toStage} --dry-run\n`);
            for (const s of set) console.log(`  + ${s}`);
            for (const s of skipped) console.log(`  - ${s} (skipped)`);
            console.log(`\n  Preview only — no secrets were changed.\n`);
          }
          break;
        }

        const result = await syncSecretsFromEnvFile(
          { stage: toStage, envFilePath: resolve(rootDir, envFile) },
          { rootDir, config, state: stateProvider, wrangler },
        );

        if (wantsJsonOutput()) {
          printJson({ stage: toStage, ...result });
          break;
        }

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
        const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));

        const statuses = await checkSecrets(
          { stage },
          { rootDir, config, state: stateProvider, wrangler },
        );
        const missing = statuses.filter((s) => s.status === "missing");

        if (missing.length === 0) {
          console.log(`\n  All secrets are set for stage "${stage}".\n`);
          break;
        }

        const stageState = await stateProvider.read(stage);
        if (wantsJsonOutput()) {
          printJson({
            stage,
            dryRun: false,
            set: missing.filter((s) => !!stageState?.workers[s.worker]?.name).map((s) => `${s.worker}/${s.name}`),
            skipped: missing.filter((s) => !stageState?.workers[s.worker]?.name).map((s) => `${s.worker}/${s.name} (worker not deployed)`),
          });
          break;
        }
        if (isDryRun(args)) {
          const preview = missing.map((s) => ({
            worker: s.worker,
            name: s.name,
            status: "missing" as const,
          }));
          if (wantsJsonOutput()) {
            printJson({ stage, dryRun: true, missing: preview });
          } else {
            console.log(`\n  wrangler-deploy secrets set --stage ${stage} --dry-run\n`);
            for (const s of preview) {
              console.log(`  ? ${s.worker}/${s.name}`);
            }
            console.log(`\n  Preview only — no secrets were changed.\n`);
          }
          break;
        }

        console.log(`\n  Setting ${missing.length} missing secret(s) for stage "${stage}":\n`);

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

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
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const statuses = await checkSecrets(
        { stage },
        { rootDir, config, state: stateProvider, wrangler },
      );

      if (wantsJsonOutput()) {
        printJson({ stage, statuses });
        break;
      }

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
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const logger = wantsJsonOutput() ? silentLogger : console;

      if (isDryRun(args)) {
        const state = await stateProvider.read(stage);
        if (!state) {
          throw new Error(`No state found for stage "${stage}". Run apply first.`);
        }

        const missingSecrets = config.secrets
          ? await validateSecrets({ stage }, { rootDir, config, state: stateProvider })
          : [];
        const result = {
          stage,
          dryRun: true,
          deployOrder: resolveDeployOrder(config),
          missingSecrets,
          workers: resolveDeployOrder(config).map((workerPath) => ({
            workerPath,
            deployedName: state.workers[workerPath]?.name ?? null,
          })),
        };
        if (wantsJsonOutput()) {
          printJson(result);
        } else {
          console.log(`\n  wrangler-deploy deploy --stage ${stage} --dry-run\n`);
          for (const workerPath of result.deployOrder) {
            const workerState = state.workers[workerPath];
            console.log(`  would deploy ${workerState?.name ?? workerPath}`);
          }
          if (missingSecrets.length > 0) {
            console.log(`\n  Missing secrets:`);
            for (const secret of missingSecrets) console.log(`    x ${secret}`);
          }
          console.log(`\n  Preview only — no workers were deployed.\n`);
        }
        break;
      }

      const result = await deploy(
        { stage, verify: hasFlag("verify") },
        {
          rootDir,
          config,
          state: stateProvider,
          wrangler,
          logger,
          validateSecretsFn: validateSecrets,
          verifyFn: verify,
        },
      );
      if (wantsJsonOutput()) {
        printJson(result);
      }
      break;
    }

    case "destroy": {
      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const logger = wantsJsonOutput() ? silentLogger : console;

      if (isDryRun(args)) {
        const state = await stateProvider.read(stage);
        if (!state) {
          const result = { stage, dryRun: true, resources: [], workers: [], detachedConsumers: [] };
          if (wantsJsonOutput()) {
            printJson(result);
          } else {
            console.log(`  No state found for stage "${stage}". Nothing to destroy.`);
          }
          break;
        }

        const workers = [...resolveDeployOrder(config)].reverse().filter((workerPath) => state.workers[workerPath]);
        const resources = Object.values(state.resources as Record<string, { source?: string; props: { name: string }; type: string }>).filter((resource) => resource.source === "managed");
        const detachedConsumers: Array<{ queue: string; worker: string }> = [];
        for (const [logicalName, resource] of Object.entries(config.resources as Record<string, { type: string; bindings: Record<string, unknown> }>)) {
          if (resource.type !== "queue") continue;
          const stateResource = state.resources[logicalName];
          const queueName = stateResource?.props.name;
          if (!queueName) continue;
          for (const [workerPath, binding] of Object.entries(resource.bindings)) {
            if (binding && typeof binding === "object" && "consumer" in binding && state.workers[workerPath]) {
              detachedConsumers.push({ queue: queueName, worker: state.workers[workerPath]!.name });
            }
          }
        }

        const result = {
          stage,
          dryRun: true,
          workers,
          resources: resources.map((resource) => ({
            name: resource.props.name,
            type: resource.type,
          })),
          detachedConsumers,
        };
        if (wantsJsonOutput()) {
          printJson(result);
        } else {
          console.log(`\n  wrangler-deploy destroy --stage ${stage} --dry-run\n`);
          for (const workerPath of workers) {
            console.log(`  would delete worker ${state.workers[workerPath]?.name ?? workerPath}`);
          }
          for (const resource of result.resources) {
            console.log(`  would delete ${resource.name} (${resource.type})`);
          }
          console.log(`\n  Preview only — no resources were changed.\n`);
        }
        break;
      }

      const result = await destroy(
        { stage, force: hasFlag("force") },
        { rootDir, config, state: stateProvider, wrangler, logger },
      );
      if (wantsJsonOutput()) {
        printJson(result);
      }
      break;
    }

    case "verify": {
      const subCmd = args[1];
      if (subCmd === "local") {
        const config = await loadConfig(rootDir);
        const pack = getFlag("pack");
        const result = await verifyLocal({ rootDir, config, pack });

        if (hasFlag("json-report") || wantsJsonOutput()) {
          printJson(result);
          if (!result.passed) process.exit(1);
          break;
        }

        console.log(`\n  wrangler-deploy verify local\n`);
        if (result.pack) {
          console.log(`  pack: ${result.pack}\n`);
        }
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

      if (!stage) throw new Error("--stage is required");
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const result = await verify({ stage }, { rootDir, config, state: stateProvider });

      if (wantsJsonOutput()) {
        printJson(result);
        if (!result.passed) process.exit(1);
        break;
      }

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

    case "snapshot": {
      const subCmd = args[1];
      const name = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const config = await loadConfig(rootDir);

      if (subCmd === "list") {
        const snapshots = listSnapshots(rootDir);
        if (wantsJsonOutput()) {
          printJson({ snapshots });
          break;
        }
        if (snapshots.length === 0) {
          console.log("\n  No snapshots saved.\n");
          break;
        }
        console.log("\n  Snapshots\n");
        for (const snapshot of snapshots) {
          console.log(`  ${snapshot.name}`);
          console.log(`    created: ${snapshot.createdAt}`);
          console.log(`    sources: ${snapshot.sources.join(", ") || "none"}`);
        }
        console.log("");
        break;
      }

      if (subCmd === "save") {
        if (!name) {
          console.error("  ✗ Usage: wd snapshot save <name>");
          process.exit(1);
        }
        const snapshot = saveSnapshot(config, rootDir, name);
        if (wantsJsonOutput()) {
          printJson(snapshot);
          break;
        }
        console.log(`\n  snapshot saved: ${snapshot.name}`);
        console.log(`  sources: ${snapshot.sources.join(", ")}\n`);
        break;
      }

      if (subCmd === "load") {
        if (!name) {
          console.error("  ✗ Usage: wd snapshot load <name>");
          process.exit(1);
        }
        const snapshot = loadSnapshot(rootDir, name);
        if (wantsJsonOutput()) {
          printJson(snapshot);
          break;
        }
        console.log(`\n  snapshot loaded: ${snapshot.name}`);
        console.log(`  sources: ${snapshot.sources.join(", ")}\n`);
        break;
      }

      console.error("  ✗ Unknown snapshot subcommand. Use: list, save, load");
      process.exit(1);
    }

    case "gc": {
      const config = await loadConfig(rootDir);
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const result = await gc({}, { rootDir, config, state: stateProvider, wrangler, logger: wantsJsonOutput() ? silentLogger : console });

      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }

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
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      if (stage) {
        const stageState = await stateProvider.read(stage);
        if (wantsJsonOutput()) {
          printJson({ stage, state: stageState });
          return;
        }
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
            `    ${r.lifecycleStatus === "created" || r.lifecycleStatus === "updated" ? "+" : "-"} ${r.props.name} (${r.type}) — ${r.lifecycleStatus}`,
          );
        }
        console.log(`\n  Workers:`);
        for (const [_path, w] of Object.entries(stageState.workers)) {
          console.log(`    ${w.name}${w.url ? ` — ${w.url}` : ""}`);
        }
        console.log("");
      } else {
        const stages = await stateProvider.list();
        if (wantsJsonOutput()) {
          const details: Array<{ stage: string; state: NonNullable<Awaited<ReturnType<typeof stateProvider.read>>> }> = [];
          for (const name of stages) {
            const state = await stateProvider.read(name);
            if (state) details.push({ stage: name, state });
          }
          printJson({ stages: details });
          return;
        }
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

    case "graph": {
      const format = getFlag("format") ?? "ascii";
      const config = await loadConfig(rootDir);
      let state;
      if (stage) {
        const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
        state = (await stateProvider.read(stage)) ?? undefined;
        if (!state && !wantsJsonOutput()) {
          console.log(`  ⚠ No state found for stage "${stage}" — showing config-only topology`);
        }
      }

      const graph = buildRichGraph(config, state);
      if (format === "json" || wantsJsonOutput()) {
        printJson(graph);
        break;
      }

      const renderers: Record<string, (g: typeof graph) => string> = { ascii: renderAscii, mermaid: renderMermaid, dot: renderDot };
      const renderer = renderers[format];
      if (!renderer) {
        console.error(`  ✗ Unknown format "${format}". Use: ascii, mermaid, dot, json`);
        process.exit(1);
      }
      console.log(renderer(graph));
      break;
    }

    case "impact": {
      const target = args[1];
      if (!target) {
        console.error("  ✗ Usage: wd impact <worker-path>");
        process.exit(1);
      }
      const config = await loadConfig(rootDir);

      const graph = buildRichGraph(config);
      const result = analyzeImpact(graph, target);

      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }

      console.log(`\n  Impact analysis for ${target}\n`);
      if (result.upstream.length > 0) {
        console.log("  Upstream (depends on):");
        for (const dep of result.upstream) {
          const shared = dep.sharedWith.length > 0 ? ` → shared with ${dep.sharedWith.join(", ")}` : " → exclusive";
          console.log(`    ${dep.id}${shared}`);
        }
      }
      if (result.downstream.length > 0) {
        console.log("\n  Downstream (depended on by):");
        for (const dep of result.downstream) {
          const label = dep.label ? ` → ${dep.label} ${dep.relationship}` : ` → ${dep.relationship}`;
          console.log(`    ${dep.id}${label}`);
        }
      }
      if (result.consequences.length > 0) {
        console.log(`\n  If ${target} is unavailable:`);
        for (const c of result.consequences) {
          console.log(`    ${c}`);
        }
      }
      console.log("");
      break;
    }

    case "dev": {
      const subCmd = args[1];
      if (subCmd === "doctor") {
        const config = await loadConfig(rootDir);
        const checks = await runDevDoctor(config, rootDir, {
          workerExists: (workerPath) =>
            existsSync(resolve(rootDir, workerPath, "wrangler.jsonc")) ||
            existsSync(resolve(rootDir, workerPath, "wrangler.json")),
          readWorkerConfig: readWranglerConfig,
          pathExists: existsSync,
        });

        console.log("\n  wrangler-deploy dev doctor\n");
        for (const check of checks) {
          const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
          console.log(`  ${icon} ${check.name}: ${check.message}`);
          if (check.details) console.log(`    ${check.details}`);
        }
        console.log("");
        break;
      }

      if (subCmd === "ui") {
        const config = await loadConfig(rootDir);
      const port = getFlag("port") ? Number.parseInt(getFlag("port")!, 10) : projectContext.basePort ?? 8899;
        const ui = await startDevUi(config, rootDir, port);
        console.log(`\n  dev ui -> http://127.0.0.1:${ui.port}\n`);
        const shutdown = async () => {
          console.log("\n  Stopping dev ui...");
          await ui.stop();
          process.exit(0);
        };
        process.on("SIGINT", () => { void shutdown(); });
        process.on("SIGTERM", () => { void shutdown(); });
        await new Promise(() => {});
      }

      const filter = getFlag("filter");
      const config = await loadConfig(rootDir);
      const fallbackStage = getFlag("fallback-stage") ?? projectContext.fallbackStage ?? config.dev?.fallbackStage;
      const basePort = getFlag("port") ? parseInt(getFlag("port")!, 10) : projectContext.basePort;
      const session = hasFlag("session") ? true : projectContext.session;
      const persistTo = getFlag("persist-to") ?? projectContext.persistTo;

      const stateProvider = (stage || fallbackStage)
        ? resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext))
        : undefined;

      const plan = await buildDevPlan(config, rootDir, {
        basePort,
        filter: filter ?? undefined,
        stage: stage ?? undefined,
        fallbackStage: fallbackStage ?? undefined,
        stateProvider,
        session,
        persistTo,
      });
      const logDir = resolveDevLogDir(rootDir);
      const handle = await startDev(plan, { logDir, rootDir });
      const sessionLogFile = plan.session ? logFilePathForTarget(logDir, "wrangler") : undefined;
      writeActiveDevState(rootDir, {
        mode: plan.mode,
        ports: handle.ports,
        workers: plan.workers.map((worker) => worker.workerPath),
        entryWorker: plan.session?.entryWorkerPath,
        entryUrl: plan.session ? `http://127.0.0.1:${handle.ports[plan.session.entryWorkerPath]}` : undefined,
        logFiles: Object.fromEntries([
          ...plan.workers.map((worker) => [
            worker.workerPath,
            sessionLogFile ?? logFilePathForTarget(logDir, worker.workerPath),
          ]),
          ...plan.companions.map((companion) => [`companion:${companion.name}`, logFilePathForTarget(logDir, companion.name)]),
          ...(plan.session ? [[`session:${plan.session.entryWorkerPath}`, sessionLogFile!]] : []),
        ]),
        updatedAt: new Date().toISOString(),
        pid: process.pid,
      });
      const shutdown = async () => {
        console.log("\n  Stopping all workers...");
        await handle.stop();
        clearActiveDevState(rootDir);
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      await new Promise(() => {});
      break;
    }

    case "cron": {
      const subCmd = args[1];
      const workerPath = args[2];
      if (!subCmd || !["trigger", "loop"].includes(subCmd) || !workerPath) {
        console.error("  ✗ Usage: wd cron trigger <worker> | wd cron loop <worker>");
        process.exit(1);
      }

      const config = await loadConfig(rootDir);
      if (!config.workers.includes(workerPath)) {
        console.error(`  ✗ Unknown worker "${workerPath}"`);
        process.exit(1);
      }

      const port = getFlag("port")
        ? Number.parseInt(getFlag("port")!, 10)
        : await resolvePlannedWorkerPort(config, rootDir, workerPath);
      const cron = getFlag("cron");
      const time = getFlag("time");
      const path = getFlag("path");

      const runTrigger = async () => {
        const result = await triggerCron({ port, cron, time, path });
        console.log(`  ${result.status} ${result.url}`);
        if (result.body.trim()) console.log(`  ${result.body.trim()}`);
        if (!result.ok) {
          throw new Error(`Local cron trigger failed with status ${result.status}`);
        }
      };

      if (subCmd === "trigger") {
        await runTrigger();
        break;
      }

      const every = parseInterval(getFlag("every") ?? "5s");
      console.log(`  Looping local cron for ${workerPath} every ${every}ms on port ${port}`);
      const shutdown = () => {
        console.log("\n  Stopping cron loop...");
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      await runTrigger();
      setInterval(() => {
        void runTrigger().catch((error) => {
          console.error(`  ✗ ${(error as Error).message}`);
        });
      }, every);
      await new Promise(() => {});
      break;
    }

    case "logs": {
      const config = await loadConfig(rootDir);
      const workerPath = args[1] && !args[1]?.startsWith("--") ? args[1] : undefined;
      const grep = getFlag("grep");
      const snapshots = readDevLogSnapshot(config, rootDir, { worker: workerPath, grep });
      const positions = new Map<string, number>();

      console.log("\n  Tailing dev logs\n");
      for (const snapshot of snapshots) {
        if (snapshot.content.trim()) {
          console.log(`  [${snapshot.workerPath}]`);
          process.stdout.write(snapshot.content);
        }
        positions.set(snapshot.logFile, snapshot.content.length);
      }

      if (hasFlag("once")) {
        console.log("");
        break;
      }

      const every = parseInterval(getFlag("every") ?? "1s");
      const shutdown = () => {
        console.log("\n  Stopping logs...");
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      while (true) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, every));
        const nextSnapshots = readDevLogSnapshot(config, rootDir, { worker: workerPath, grep });
        for (const snapshot of nextSnapshots) {
          const previous = positions.get(snapshot.logFile) ?? 0;
          if (snapshot.content.length > previous) {
            const nextChunk = snapshot.content.slice(previous);
            process.stdout.write(nextChunk);
            positions.set(snapshot.logFile, snapshot.content.length);
          }
        }
      }
    }

    case "fixture": {
      const subCmd = args[1];
      if (subCmd !== "list") {
        console.error("  ✗ Usage: wd fixture list");
        process.exit(1);
      }

      const config = await loadConfig(rootDir);
      const fixtures = listFixtures(config);
      if (wantsJsonOutput()) {
        printJson({ fixtures });
        break;
      }
      if (fixtures.length === 0) {
        console.log("\n  No fixtures declared.\n");
        break;
      }

      console.log("\n  Fixtures\n");
      for (const { name, fixture } of fixtures) {
        if (fixture.type === "worker") {
          const route = fixture.endpoint
            ? `endpoint=${fixture.endpoint}`
            : `${fixture.method ?? "GET"} ${fixture.path ?? "/"}`;
          console.log(`  ${name} [worker]`);
          console.log(`    ${fixture.worker} ${route}`);
        } else if (fixture.type === "queue") {
          console.log(`  ${name} [queue]`);
          console.log(`    ${fixture.queue}${fixture.worker ? ` via ${fixture.worker}` : ""}`);
        } else {
          const target = fixture.sql ? "sql" : fixture.file ? `file=${fixture.file}` : "empty";
          console.log(`  ${name} [d1]`);
          console.log(`    ${fixture.database}${fixture.worker ? ` via ${fixture.worker}` : ""} ${target}`);
        }
        if (fixture.description) console.log(`    ${fixture.description}`);
      }
      console.log("");
      break;
    }

    case "worker": {
      const subCmd = args[1];
      const workerPath = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const fixtureName = getFlag("fixture");

      if (subCmd === "routes") {
        const config = await loadConfig(rootDir);
        const routes = (await listWorkerRoutes(config, rootDir))
          .filter((route) => !workerPath || route.workerPath === workerPath);
        if (routes.length === 0) {
          console.error(`  ✗ Unknown worker "${workerPath}"`);
          process.exit(1);
        }

        if (wantsJsonOutput()) {
          printJson({ routes });
          break;
        }

        console.log("\n  Worker routes\n");
        for (const route of routes) {
          console.log(`  ${route.workerPath}`);
          console.log(`    url: ${route.url}`);
          if (route.endpoints.length === 0) {
            console.log("    endpoints: none");
            continue;
          }
          for (const endpoint of route.endpoints) {
            console.log(`    endpoint ${endpoint.name}: ${endpoint.method ?? "GET"} ${endpoint.path}`);
          }
        }
        console.log("");
        break;
      }

      if (subCmd !== "call" || (!workerPath && !fixtureName)) {
        console.error("  ✗ Usage: wd worker call <worker> [--fixture <name>] | wd worker call --fixture <name> | wd worker routes [worker]");
        process.exit(1);
      }

      const config = await loadConfig(rootDir);
      const fixture = fixtureName ? getWorkerFixture(config, fixtureName) : undefined;
      if (fixtureName && !fixture) {
        console.error(`  ✗ Unknown worker fixture "${fixtureName}"`);
        process.exit(1);
      }

      const resolvedWorker = workerPath ?? fixture?.worker;
      if (!resolvedWorker) {
        console.error("  ✗ worker call requires a worker path or a worker fixture");
        process.exit(1);
      }
      if (!config.workers.includes(resolvedWorker)) {
        console.error(`  ✗ Unknown worker "${resolvedWorker}"`);
        process.exit(1);
      }
      if (fixture && workerPath && fixture.worker !== workerPath) {
        console.error(`  ✗ Fixture "${fixtureName}" belongs to "${fixture.worker}", not "${workerPath}"`);
        process.exit(1);
      }

      const method = getFlag("method")?.toUpperCase() ?? fixture?.method?.toUpperCase();
      const endpoint = getFlag("endpoint") ?? fixture?.endpoint;
      const path = getFlag("path") ?? fixture?.path;
      const port = getFlag("port") ? Number.parseInt(getFlag("port")!, 10) : undefined;
      const query = { ...(fixture?.query ?? {}), ...parseKeyValueFlags(getFlags("query"), "query") };
      const headers = { ...(fixture?.headers ?? {}), ...parseKeyValueFlags(getFlags("header"), "header") };
      const inlineJson = getFlag("json");
      const inlineBody = getFlag("body");
      const bodyFile = getFlag("body-file");
      const bodySources = [inlineJson, inlineBody, bodyFile].filter((value) => value !== undefined);
      if (bodySources.length > 1) {
        console.error("  ✗ Use only one of --json, --body, or --body-file");
        process.exit(1);
      }

      const body = inlineJson
        ?? inlineBody
        ?? (bodyFile ? readFileSync(resolve(rootDir, bodyFile), "utf-8") : undefined)
        ?? fixture?.body;
      if (inlineJson && headers["content-type"] === undefined) {
        headers["content-type"] = "application/json";
      }

      const runCall = async () => {
        const result = await callWorker(config, rootDir, {
          worker: resolvedWorker,
          endpoint,
          method,
          port,
          path,
          query,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          body,
        });

        if (wantsJsonOutput()) {
          printJson(result);
          return;
        }

        console.log(`\n  worker ${result.target.workerPath}`);
        console.log(`  ${result.method} ${result.target.url}`);
        console.log(`  ${result.status}`);
        if (Object.keys(result.headers).length > 0) {
          console.log("  response headers:");
          for (const [key, value] of Object.entries(result.headers)) {
            console.log(`    ${key}: ${value}`);
          }
        }
        if (result.body.trim()) console.log(`  ${result.body.trim()}`);
        if (!result.ok) throw new Error("worker call failed");
        console.log("");
      };

      const watch = hasFlag("watch");
      if (!watch) {
        await runCall();
        break;
      }

      const every = parseInterval(getFlag("every") ?? "5s");
      const count = getFlag("count") ? Number.parseInt(getFlag("count")!, 10) : undefined;
      let calls = 0;
      console.log(`  Watching worker ${resolvedWorker} every ${every}ms`);
      const shutdown = () => {
        console.log("\n  Stopping worker watch...");
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      while (true) {
        await runCall();
        calls += 1;
        if (count !== undefined && calls >= count) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, every));
      }
      break;
    }

    case "d1": {
      const subCmd = args[1];
      const logicalName = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const config = await loadConfig(rootDir);
      const fixtureName = getFlag("fixture");

      if (subCmd === "list") {
        const databases = listD1Databases(config);
        if (wantsJsonOutput()) {
          printJson({ databases });
          break;
        }
        if (databases.length === 0) {
          console.log("\n  No D1 databases declared.\n");
          break;
        }
        console.log("\n  D1 databases\n");
        for (const database of databases) {
          console.log(`  ${database.logicalName}`);
          console.log(`    bindings: ${database.bindings.map((binding) => `${binding.workerPath}:${binding.binding}`).join(", ")}`);
        }
        console.log("");
        break;
      }

      if (subCmd === "inspect") {
        if (!logicalName) {
          console.error("  ✗ Usage: wd d1 inspect <database>");
          process.exit(1);
        }
        const database = getD1Database(config, logicalName);
        if (!database) {
          console.error(`  ✗ Unknown D1 database "${logicalName}"`);
          process.exit(1);
        }

        if (wantsJsonOutput()) {
          printJson({ database });
          break;
        }

        console.log(`\n  D1: ${database.logicalName}\n`);
        console.log(`  bindings: ${database.bindings.map((binding) => `${binding.workerPath}:${binding.binding}`).join(", ")}`);
        const workflow = config.dev?.d1?.[logicalName];
        if (workflow?.seedFile) console.log(`  seed file: ${workflow.seedFile}`);
        if (workflow?.resetFile) console.log(`  reset file: ${workflow.resetFile}`);
        if (workflow?.worker) console.log(`  default worker: ${workflow.worker}`);
        console.log("");
        break;
      }

      const fixture = fixtureName ? getD1Fixture(config, fixtureName) : undefined;
      if (fixtureName && !fixture) {
        console.error(`  ✗ Unknown D1 fixture "${fixtureName}"`);
        process.exit(1);
      }
      const resolvedDatabase = logicalName ?? fixture?.database;

      if (!resolvedDatabase) {
        console.error("  ✗ Usage: wd d1 <exec|seed|reset> <database> | wd d1 exec --fixture <name>");
        process.exit(1);
      }

      const wrangler = createWranglerRunner();
      const worker = getFlag("worker") ?? fixture?.worker;
      if (subCmd === "exec") {
        const sql = getFlag("sql") ?? fixture?.sql;
        const file = getFlag("file") ?? fixture?.file;
        if (!sql && !file) {
          console.error("  ✗ wd d1 exec requires --sql, --file, or a D1 fixture");
          process.exit(1);
        }
        if (sql && file) {
          console.error("  ✗ Use only one of --sql or --file");
          process.exit(1);
        }
        const result = executeLocalD1(config, rootDir, wrangler, {
          database: resolvedDatabase,
          worker,
          sql,
          file,
        });
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }
        console.log(`\n  d1 ${resolvedDatabase} -> ${result.target.workerPath}`);
        console.log(`  ${result.output}\n`);
        break;
      }

      if (subCmd === "seed" || subCmd === "reset") {
        const configuredFile = subCmd === "seed"
          ? config.dev?.d1?.[resolvedDatabase]?.seedFile
          : config.dev?.d1?.[resolvedDatabase]?.resetFile;
        const file = getFlag("file") ?? configuredFile;
        if (!file) {
          console.error(`  ✗ wd d1 ${subCmd} requires --file or dev.d1["${resolvedDatabase}"].${subCmd}File`);
          process.exit(1);
        }
        const result = executeLocalD1(config, rootDir, wrangler, {
          database: resolvedDatabase,
          worker,
          file,
        });
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }
        console.log(`\n  d1 ${subCmd} ${resolvedDatabase} -> ${result.target.workerPath}`);
        console.log(`  ${result.output}\n`);
        break;
      }

      console.error("  ✗ Unknown d1 subcommand. Use: list, inspect, exec, seed, reset");
      process.exit(1);
    }

    case "queue": {
      const subCmd = args[1];
      const config = await loadConfig(rootDir);
      const fixtureName = getFlag("fixture");

      if (subCmd === "list") {
        const routes = listQueueRoutes(config);
        if (wantsJsonOutput()) {
          printJson({ routes });
          break;
        }
        if (routes.length === 0) {
          console.log("\n  No queues declared.\n");
          break;
        }

        console.log("\n  Queue topology\n");
        for (const route of routes) {
          const producerNames = route.producers.map((producer) => `${producer.workerPath}:${producer.binding}`).join(", ") || "none";
          const consumerNames = route.consumers.map((consumer) => consumer.workerPath).join(", ") || "none";
          const dlq = route.deadLetterFor ? ` → dead-letter for ${route.deadLetterFor}` : "";
          console.log(`  ${route.logicalName}${dlq}`);
          console.log(`    producers: ${producerNames}`);
          console.log(`    consumers: ${consumerNames}`);
        }
        console.log("");
        break;
      }

      if (subCmd === "inspect") {
        const logicalName = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
        if (!logicalName) {
          console.error("  ✗ Usage: wd queue inspect <queue>");
          process.exit(1);
        }

        const route = getQueueRoute(config, logicalName);
        if (!route) {
          console.error(`  ✗ Unknown queue "${logicalName}"`);
          process.exit(1);
        }

        if (wantsJsonOutput()) {
          printJson({ route });
          break;
        }

        console.log(`\n  Queue: ${route.logicalName}\n`);
        console.log(`  producers: ${route.producers.map((producer) => `${producer.workerPath}:${producer.binding}`).join(", ") || "none"}`);
        console.log(`  consumers: ${route.consumers.map((consumer) => consumer.workerPath).join(", ") || "none"}`);
        console.log(`  dead-letter-for: ${route.deadLetterFor ?? "none"}`);
        console.log("");
        break;
      }

      if (subCmd === "send") {
        const logicalName = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
        const fixture = fixtureName ? getQueueFixture(config, fixtureName) : undefined;
        if (fixtureName && !fixture) {
          console.error(`  ✗ Unknown queue fixture "${fixtureName}"`);
          process.exit(1);
        }
        const resolvedQueue = logicalName ?? fixture?.queue;
        if (!resolvedQueue) {
          console.error("  ✗ Usage: wd queue send <queue> --json '<payload>' | --file payload.json | --fixture <name>");
          process.exit(1);
        }

        const inlinePayload = getFlag("payload");
        const filePayload = getFlag("payload-file");
        const fixturePayload = fixture?.payload;
        if (!inlinePayload && !filePayload && !fixturePayload) {
          console.error("  ✗ queue send requires --payload, --payload-file, or a queue fixture");
          process.exit(1);
        }
        if (inlinePayload && filePayload) {
          console.error("  ✗ Use only one of --payload or --payload-file");
          process.exit(1);
        }

        const payload = inlinePayload ?? (filePayload ? readFileSync(resolve(rootDir, filePayload), "utf-8") : undefined) ?? fixturePayload!;
        const port = getFlag("port") ? Number.parseInt(getFlag("port")!, 10) : undefined;
        const worker = getFlag("worker") ?? fixture?.worker;
        const path = getFlag("path");
        const watch = hasFlag("watch");
        const runSend = async () => {
          const result = await sendQueueMessage(config, rootDir, {
            queue: resolvedQueue,
            payload,
            worker,
            port,
            path,
          });

          if (wantsJsonOutput()) {
            printJson(result);
            return;
          }

          console.log(`\n  queue ${resolvedQueue} -> ${result.target.workerPath}`);
          console.log(`  ${result.status} ${result.target.url}`);
          if (result.body.trim()) console.log(`  ${result.body.trim()}`);
          if (!result.ok) throw new Error("queue send failed");
          console.log("");
        };

        if (!watch) {
          await runSend();
          break;
        }

        const every = parseInterval(getFlag("every") ?? "5s");
        const count = getFlag("count") ? Number.parseInt(getFlag("count")!, 10) : undefined;
        let sent = 0;
        console.log(`  Watching queue ${resolvedQueue} every ${every}ms`);
        const shutdown = () => {
          console.log("\n  Stopping queue watch...");
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        while (true) {
          await runSend();
          sent++;
          if (count !== undefined && sent >= count) break;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, every));
        }
        break;
      }

      if (subCmd === "replay") {
        const logicalName = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
        const filePath = getFlag("file");
        if (!logicalName || !filePath) {
          console.error("  ✗ Usage: wd queue replay <queue> --file payloads.json");
          process.exit(1);
        }

        const raw = readFileSync(resolve(rootDir, filePath), "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          console.error("  ✗ queue replay file must contain a JSON array");
          process.exit(1);
        }

        const payloads = parsed.map((entry) => JSON.stringify(entry));
        const port = getFlag("port") ? Number.parseInt(getFlag("port")!, 10) : undefined;
        const worker = getFlag("worker");
        const path = getFlag("path");

        const result = await replayQueueMessages(config, rootDir, {
          queue: logicalName,
          payloads,
          worker,
          port,
          path,
        });

        const failures = result.results.filter((entry) => !entry.ok);
        if (wantsJsonOutput()) {
          printJson(result);
          if (failures.length > 0) process.exit(1);
          break;
        }
        console.log(`\n  replay ${logicalName} -> ${result.target.workerPath}`);
        console.log(`  sent ${result.sent} message(s) to ${result.target.url}`);
        if (failures.length > 0) {
          console.log(`  ${failures.length} failed`);
          process.exit(1);
        }
        console.log("  all messages accepted\n");
        break;
      }

      if (subCmd === "tail") {
        const logicalName = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
        if (!logicalName) {
          console.error("  ✗ Usage: wd queue tail <queue> [--worker <worker>]");
          process.exit(1);
        }

        const worker = getFlag("worker");
        const files = readQueueTailSnapshot(config, rootDir, { queue: logicalName, worker });
        const positions = new Map<string, number>();

        console.log(`\n  Tailing queue ${logicalName}\n`);
        for (const file of files) {
          if (file.content.trim()) {
            console.log(`  [${file.workerPath}]`);
            process.stdout.write(file.content);
          }
          positions.set(file.logFile, file.content.length);
        }

        const follow = !hasFlag("once");
        if (!follow) {
          console.log("");
          break;
        }

        const every = parseInterval(getFlag("every") ?? "1s");
        const shutdown = () => {
          console.log("\n  Stopping queue tail...");
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        while (true) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, every));
          const snapshots = readQueueTailSnapshot(config, rootDir, { queue: logicalName, worker });
          for (const snapshot of snapshots) {
            const previous = positions.get(snapshot.logFile) ?? 0;
            if (snapshot.content.length > previous) {
              const nextChunk = snapshot.content.slice(previous);
              process.stdout.write(nextChunk);
              positions.set(snapshot.logFile, snapshot.content.length);
            }
          }
        }
      }

      console.error('  ✗ Unknown queue subcommand. Use: list, inspect, send, replay, tail');
      process.exit(1);
    }

    case "ci": {
  const subCmd = args[1];
  if (subCmd === "init") {
    const provider = getFlag("provider") ?? "github";
    if (provider !== "github") { console.error(`  ✗ Unknown provider "${provider}". Supported: github`); process.exit(1); }
    const mainBranch = getFlag("branch") ?? "main";
    const yaml = generateGitHubWorkflow({ mainBranch });
    const dir = resolve(rootDir, ".github/workflows");
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, "wrangler-deploy.yml");
    writeFileSync(path, yaml);
    console.log(`  ✓ Generated ${path}`);
    break;
  }
  if (!stage) { console.error("  ✗ --stage required for ci comment/check"); process.exit(1); }
  if (subCmd === "comment") {
    const ci = detectCiEnvironment(process.env as Record<string, string>);
    if (!ci) { console.error("  ✗ Not in supported CI"); process.exit(1); }
    if (!ci.prNumber) { console.log("  ⚠ Not a PR — skipping"); break; }
    const config = await loadConfig(rootDir);
    const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
    const state = await stateProvider.read(stage);
    if (!state) { console.error(`  ✗ No state for "${stage}"`); process.exit(1); }
    const comment = buildPrComment(config, state);
    const ghProvider = createGitHubProvider(ci);
    await ghProvider.updateComment(ci.prNumber, comment, "<!-- wrangler-deploy -->");
    console.log(`  ✓ PR #${ci.prNumber} comment updated`);
    break;
  }
  if (subCmd === "check") {
    const ci = detectCiEnvironment(process.env as Record<string, string>);
    if (!ci) { console.error("  ✗ Not in supported CI"); process.exit(1); }
    const config = await loadConfig(rootDir);
    const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
    const state = await stateProvider.read(stage);
    const ghProvider = createGitHubProvider(ci);
    const result = await postCheckRun(ghProvider, stage, state);
    if (result.status === "success") {
      console.log(`  ✓ Check run posted for ${stage}`);
    } else {
      console.error(`  ✗ ${result.detail}`);
      process.exit(1);
    }
    break;
  }
  console.error(`  ✗ Unknown ci subcommand "${subCmd}". Use: init, comment, check`);
  process.exit(1);
}

    case "diff": {
      const stageA = args[1];
      const stageB = args[2];
      if (!stageA || !stageB) {
        console.error("  ✗ Usage: wd diff <stage-a> <stage-b>");
        process.exit(1);
      }
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const a = await stateProvider.read(stageA);
      const b = await stateProvider.read(stageB);
      if (!a) { console.error(`  ✗ No state found for stage "${stageA}"`); process.exit(1); }
      if (!b) { console.error(`  ✗ No state found for stage "${stageB}"`); process.exit(1); }

      const result = diffStages(a, b);
      const format = getFlag("format");

      if (format === "json" || wantsJsonOutput()) {
        printJson(result);
        break;
      }

      console.log(`\n  Diff: ${stageA} vs ${stageB}\n`);
      if (result.resources.length > 0) {
        console.log("  Resources:");
        for (const r of result.resources) {
          const icon = r.status === "same" ? "=" : r.status === "only-in-a" ? "+" : r.status === "only-in-b" ? "-" : "~";
          console.log(`    ${icon} ${r.name} (${r.type}) — ${r.status}`);
        }
      }
      if (result.workers.length > 0) {
        console.log("\n  Workers:");
        for (const w of result.workers) {
          const icon = w.status === "same" ? "=" : w.status === "only-in-a" ? "+" : "-";
          console.log(`    ${icon} ${w.path} — ${w.status}`);
        }
      }
      if (result.secrets.length > 0) {
        console.log("\n  Secrets:");
        for (const s of result.secrets) {
          console.log(`    ~ ${s.worker}/${s.name}: ${stageA}=${s.inA}, ${stageB}=${s.inB}`);
        }
      }
      console.log("");
      break;
    }

    case "doctor": {
      const config = await loadConfig(rootDir);
      const deps = {
        wranglerVersion: () => execFileSync("npx", ["wrangler", "--version"], { encoding: "utf-8" }).trim(),
        wranglerAuth: () => execFileSync("npx", ["wrangler", "whoami"], { encoding: "utf-8" }).trim(),
        workerExists: (p: string) => existsSync(resolve(rootDir, p, "wrangler.jsonc")) || existsSync(resolve(rootDir, p, "wrangler.json")),
        configErrors: validateConfig(config),
      };

      const checks = runDoctor(config, deps);
      if (wantsJsonOutput()) {
        printJson({ checks });
        break;
      }
      console.log("\n  wrangler-deploy doctor\n");
      for (const check of checks) {
        const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
        console.log(`  ${icon} ${check.name}: ${check.message}`);
        if (check.details) console.log(`    ${check.details}`);
      }
      console.log("");
      break;
    }

    case "completions": {
      const shell = getFlag("shell");
      if (!shell || !["zsh", "bash", "fish"].includes(shell)) {
        console.error("  ✗ Usage: wd completions --shell zsh|bash|fish");
        process.exit(1);
      }
      console.log(generateCompletions(shell as "zsh" | "bash" | "fish"));
      break;
    }

    case "schema": {
      printJson(cliManifest);
      break;
    }

    case "context": {
      const subCommand = args[1];

      if (subCommand === "get") {
        const validKeys: Array<keyof ProjectContext> = [
          "stage",
          "fallbackStage",
          "basePort",
          "filter",
          "session",
          "persistTo",
          "accountId",
          "databaseUrl",
          "statePassword",
        ];
        const keyName = getFlag("key") ?? args[2];
        if (!keyName || !validKeys.includes(keyName as keyof ProjectContext)) {
          throw new Error(`context get requires one of: ${validKeys.join(", ")}`);
        }

        const value = getProjectContextValue(rootDir, keyName as keyof ProjectContext);
        const result = { key: keyName, value };
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }

        console.log("\n  wrangler-deploy context get\n");
        console.log(`  ${keyName}: ${JSON.stringify(value)}`);
        console.log("");
        break;
      }

      if (subCommand === "set") {
        const updates: Record<string, unknown> = {};
        const basePort = getFlag("base-port");
        if (getFlag("stage") !== undefined) updates.stage = getFlag("stage");
        if (getFlag("fallback-stage") !== undefined) updates.fallbackStage = getFlag("fallback-stage");
        if (basePort !== undefined) updates.basePort = Number.parseInt(basePort, 10);
        if (getFlag("filter") !== undefined) updates.filter = getFlag("filter");
        if (hasFlag("session")) updates.session = true;
        if (getFlag("persist-to") !== undefined) updates.persistTo = getFlag("persist-to");
        if (getFlag("account-id") !== undefined) updates.accountId = getFlag("account-id");
        if (getFlag("database-url") !== undefined) updates.databaseUrl = getFlag("database-url");
        if (getFlag("state-password") !== undefined) updates.statePassword = getFlag("state-password");

        if (Object.keys(updates).length === 0) {
          throw new Error(
            "context set requires at least one flag: --stage, --fallback-stage, --base-port, --filter, --session, --persist-to, --account-id, --database-url, or --state-password",
          );
        }

        const result = writeProjectContext(rootDir, updates as Partial<{
          stage: string;
          fallbackStage: string;
          basePort: number;
          filter: string;
          session: boolean;
          persistTo: string;
          accountId: string;
          databaseUrl: string;
          statePassword: string;
        }>);

        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }

        console.log("\n  wrangler-deploy context set\n");
        console.log(`  file: ${result.path}`);
        for (const [key, value] of Object.entries(result.context)) {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        }
        console.log("");
        break;
      }

      if (subCommand === "unset") {
        const keys: Array<keyof ProjectContext> = [];
        if (hasFlag("stage")) keys.push("stage");
        if (hasFlag("fallback-stage")) keys.push("fallbackStage");
        if (hasFlag("base-port")) keys.push("basePort");
        if (hasFlag("filter")) keys.push("filter");
        if (hasFlag("session")) keys.push("session");
        if (hasFlag("persist-to")) keys.push("persistTo");
        if (hasFlag("account-id")) keys.push("accountId");
        if (hasFlag("database-url")) keys.push("databaseUrl");
        if (hasFlag("state-password")) keys.push("statePassword");

        if (keys.length === 0) {
          throw new Error(
            "context unset requires at least one flag: --stage, --fallback-stage, --base-port, --filter, --session, --persist-to, --account-id, --database-url, or --state-password",
          );
        }

        const result = unsetProjectContext(rootDir, keys);
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }

        console.log("\n  wrangler-deploy context unset\n");
        console.log(`  file: ${result.path}`);
        if (Object.keys(result.context).length === 0) {
          console.log("  (defaults cleared)");
        } else {
          for (const [key, value] of Object.entries(result.context)) {
            console.log(`  ${key}: ${JSON.stringify(value)}`);
          }
        }
        console.log("");
        break;
      }

      if (subCommand === "clear") {
        const result = clearProjectContext(rootDir);
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }

        console.log("\n  wrangler-deploy context clear\n");
        console.log(`  file: ${result.path}`);
        console.log("  defaults cleared\n");
        break;
      }

      const details = {
        path: projectContextDetails.path ?? null,
        context: projectContext,
      };

      if (wantsJsonOutput()) {
        printJson(details);
        break;
      }

      console.log("\n  wrangler-deploy context\n");
      console.log(`  file: ${details.path ?? "none"}`);
      for (const [key, value] of Object.entries(details.context)) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      }
      if (Object.keys(details.context).length === 0) {
        console.log("  (no defaults found)");
      }
      console.log("");
      break;
    }

    case "tools": {
      const tools = cliManifest.commands.map((entry) => ({
        name: entry.subcommands?.length ? `wd ${entry.name} ${entry.subcommands[0]}` : `wd ${entry.name}`,
        description: entry.description,
        mutating: entry.mutating ?? false,
        output: entry.output ?? "text",
        flags: entry.flags ?? [],
        subcommands: entry.subcommands ?? [],
      }));

      if (wantsJsonOutput()) {
        printJson({ package: cliManifest.package, version: cliManifest.version, tools });
        break;
      }

      console.log("\n  wrangler-deploy tools\n");
      for (const tool of tools) {
        console.log(`  ${tool.name}`);
        console.log(`    ${tool.description}`);
        if (tool.flags.length > 0) console.log(`    flags: ${tool.flags.join(", ")}`);
        if (tool.subcommands.length > 0) console.log(`    subcommands: ${tool.subcommands.join(", ")}`);
      }
      console.log("");
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run "wrangler-deploy help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  Error: ${formatCliError(err)}\n`);
  process.exit(1);
});
