#!/usr/bin/env node

import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createWranglerRunner } from "../core/wrangler-runner.js";
import { resolveStateProvider } from "../core/state.js";
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
import { introspect } from "../core/introspect.js";
import { buildRichGraph } from "../core/graph-model.js";
import { renderAscii, renderMermaid, renderDot, renderJson } from "../core/renderers/index.js";
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

const args = process.argv.slice(2);
const command = args[0];

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
    verify   Post-deploy coherence check or local runtime verification
    graph       [--stage <name>] [--format ascii|mermaid|dot|json]  Show topology
    impact      <worker-path>                                       Show dependency impact
    diff        <stage-a> <stage-b> [--format json]                 Compare stages
    dev         [--filter <worker>] [--port <base>] [--session]     Start local dev
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

  Secrets sub-commands:
    secrets --stage <name>                           Check secret status
    secrets set --stage <name>                       Interactively set missing secrets
    secrets sync --to <stage> --from-env-file <path> Bulk set from .dev.vars file

  Options:
    --stage <name>       Stage name (required)
    --database-url <url> Postgres URL (required for Hyperdrive on first apply)
    --force              Force destructive operations on protected stages
    --verify             Run verification after deploy
    --session            Run wrangler dev as a single multi-config local session
    --persist-to <path>  Persist Miniflare state for session mode
    --pack <name>        Run a named verify-local pack
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
    --json <payload>      Inline JSON payload for queue send
    --file <path>         JSON payload file for queue send
    --worker <worker>     Explicit producer worker for queue send
    --watch               Repeat queue send on an interval
    --count <number>      Stop queue send watch after N sends
    --follow              Keep following queue tail output (default)
    --once                Print the current queue tail snapshot and exit

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
      const subCmd = args[1];
      if (subCmd === "local") {
        const config = await loadConfig(rootDir);
        const pack = getFlag("pack");
        const result = await verifyLocal({ rootDir, config, pack });

        if (hasFlag("json-report")) {
          console.log(JSON.stringify(result, null, 2));
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

    case "snapshot": {
      const subCmd = args[1];
      const name = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const config = await loadConfig(rootDir);

      if (subCmd === "list") {
        const snapshots = listSnapshots(rootDir);
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

    case "graph": {
  const format = getFlag("format") ?? "ascii";
  const config = await loadConfig(rootDir);
  let state;
  if (stage) {
    const stateProvider = resolveStateProvider(rootDir, config.state);
    state = await stateProvider.read(stage) ?? undefined;
    if (!state) {
      console.log(`  ⚠ No state found for stage "${stage}" — showing config-only topology`);
    }
  }

  const graph = buildRichGraph(config, state);
  const renderers: Record<string, (g: typeof graph) => string> = { ascii: renderAscii, mermaid: renderMermaid, dot: renderDot, json: renderJson };
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
        const checks = runDevDoctor(config, rootDir, {
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
        const port = getFlag("port") ? Number.parseInt(getFlag("port")!, 10) : 8899;
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
      const basePort = getFlag("port") ? parseInt(getFlag("port")!, 10) : undefined;
      const session = hasFlag("session");
      const persistTo = getFlag("persist-to");
      const config = await loadConfig(rootDir);
      const plan = buildDevPlan(config, rootDir, {
        basePort,
        filter: filter ?? undefined,
        session,
        persistTo,
      });
      const logDir = resolveDevLogDir(rootDir);
      const handle = await startDev(plan, { logDir });
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
        : resolvePlannedWorkerPort(config, rootDir, workerPath);
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
        const routes = listWorkerRoutes(config, rootDir)
          .filter((route) => !workerPath || route.workerPath === workerPath);
        if (routes.length === 0) {
          console.error(`  ✗ Unknown worker "${workerPath}"`);
          process.exit(1);
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

        const inlinePayload = getFlag("json");
        const filePayload = getFlag("file");
        const fixturePayload = fixture?.payload;
        if (!inlinePayload && !filePayload && !fixturePayload) {
          console.error("  ✗ queue send requires --json, --file, or a queue fixture");
          process.exit(1);
        }
        if (inlinePayload && filePayload) {
          console.error("  ✗ Use only one of --json or --file");
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
    const stateProvider = resolveStateProvider(rootDir, config.state);
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
    const stateProvider = resolveStateProvider(rootDir, config.state);
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
  const stateProvider = resolveStateProvider(rootDir, config.state);
  const a = await stateProvider.read(stageA);
  const b = await stateProvider.read(stageB);
  if (!a) { console.error(`  ✗ No state found for stage "${stageA}"`); process.exit(1); }
  if (!b) { console.error(`  ✗ No state found for stage "${stageB}"`); process.exit(1); }

  const result = diffStages(a, b);
  const format = getFlag("format");

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
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

    default:
      console.error(`Unknown command: ${command}. Run "wrangler-deploy help" for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  Error: ${(err as Error).message}\n`);
  process.exit(1);
});
