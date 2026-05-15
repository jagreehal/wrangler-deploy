#!/usr/bin/env node

import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync } from "node:fs";
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
  buildSecretSyncPreview,
  checkSecrets,
  setSecret,
  syncSecretsFromEnvFile,
  validateSecrets,
} from "../core/secrets.js";
import { gc } from "../core/gc.js";
import { generateConfig } from "../core/init.js";
import { createHelloStarter } from "../core/create.js";
import { detectPackageManager, runInstall } from "../core/scaffold-install.js";
import {
  deriveSubstitutions,
  fetchTemplate,
  loadTemplateManifest,
  resolveTemplateSource,
} from "../core/scaffold.js";
import { detectNonInteractive, runPicker } from "../core/scaffold-picker.js";
import { introspect } from "../core/introspect.js";
import { buildRichGraph } from "../core/graph-model.js";
import { resolveDeployOrder } from "../core/graph.js";
import { renderAscii, renderMermaid, renderDot } from "../core/renderers/index.js";
import { analyzeImpact } from "../core/impact.js";
import { runStatus } from "../core/guard/status.js";
import { renderStatusTable, renderStatusJson } from "../core/guard/render-table.js";
import { createGuardClient } from "../core/guard/client.js";
import { runBreaches, renderBreachesTable, renderBreachesJson } from "../core/guard/breaches.js";
import { runReport, renderReportText, renderReportJson } from "../core/guard/report.js";
import { runDisarm, runArm } from "../core/guard/disarm.js";
import { generateSigningKey, createD1Database } from "../core/guard/init.js";
import { runListApprovals, runApprove, runReject } from "../core/guard/approvals.js";
import { deployGuard } from "../core/guard/deploy.js";
import { runMigrations } from "../core/guard/migrate.js";
import { fetchWorkerUsage, type NotificationChannelConfig } from "workers-usage-guard-shared";
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
  AgentErrors,
  assertStage,
  assertStageState,
  assertUsage,
  throwAgentError,
  buildErrorEnvelope,
  enforceSandboxGuard,
  isDryRun,
  isQuiet,
  isSandboxMode,
  parseNoColor,
  parseNoInteractive,
  parseNoSecretsInOutput,
  parseOutputFields,
  parseOutputFormat,
  parseOutputPath,
  parseQuiet,
  parseSandboxMode,
  printJson,
  readCommandInput,
  setJsonOutputOptions,
  setNoColor,
  setNoInteractive,
  setNoSecretsInOutput,
  setOutputFile,
  setQuietMode,
  setSandboxMode,
  writeArtifactFile,
} from "../core/cli-output.js";
import { allExampleSets, getExamples, listExampleCommands } from "../core/examples.js";
import { defaultUserStage } from "../core/defaults.js";
import { loadEnvFileFromArgs } from "../core/dotenv.js";
import {
  applyProfileToEnv,
  defaultProfileName,
  deleteCloudflareCredential,
  getProfile,
  listProfiles,
  profileCredentialsPath,
  profilesConfigPath,
  removeProfile,
  resolveProfileSelection,
  upsertCloudflareProfile,
  writeCloudflareCredential,
  type AuthMethod,
} from "../core/profiles.js";
import {
  dashboardCreateUrl,
  REQUIRED_SCOPES,
  renderTokenInstructions,
  tokenInstructionsJson,
} from "../core/cf-token.js";
import {
  buildStateList,
  buildStateTree,
  getStateEntry,
  renderStateGetText,
  renderStateListText,
  renderTreeAscii,
} from "../core/state-commands.js";
import { startTunnel } from "../core/tunnel.js";
import { parseVibeTargets, writeVibeRules } from "../core/vibe-rules.js";
import { resolveWatchTargets, startWatch } from "../core/watch.js";
import { eraseSecrets, rotatePassword } from "../core/rotate-password.js";
import { openUrl } from "../core/open-url.js";
import { copyToClipboard } from "../core/clipboard.js";
import { explainIssue } from "../core/explain.js";
import { outputSchemas } from "../core/output-schemas.js";
import { schemaForCommand } from "../core/output-schemas.js";
import { configSchema } from "../core/config-schema.js";
import { detectSandboxCapabilities, runInSandbox } from "../core/sandbox.js";
import { listWorkersWithUrl, matchWorker, promptWorkerChoice, resolveDefaultWorker } from "../core/ux.js";
import { codeForDoctorCheck } from "../core/doctor-codes.js";
import { evaluateCheck } from "../core/check.js";
import { appendRollbackEvent, listKnownVersions } from "../core/history.js";
import { macroCommandName, splitMacroBody, tokenizeCommandText } from "../core/macro.js";
import type { ProjectContext } from "../types.js";

class UsageError extends Error {
  readonly kind = "usage" as const;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function isUsageError(error: unknown): error is UsageError {
  return error instanceof Error && (error as { kind?: string }).kind === "usage";
}

const args = process.argv.slice(2);
const command = args[0];
const outputFormat = parseOutputFormat(args);
setJsonOutputOptions({
  fields: parseOutputFields(args),
  ndjson: args.includes("--ndjson") || getFlag("format") === "ndjson",
});
setQuietMode(parseQuiet(args));
setNoColor(parseNoColor(args));
setNoInteractive(parseNoInteractive(args));
setNoSecretsInOutput(parseNoSecretsInOutput(args));
setSandboxMode(parseSandboxMode(args));
setOutputFile(parseOutputPath(args));
const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

const MUTATING_COMMANDS = new Set([
  "apply",
  "deploy",
  "destroy",
  "rollback",
  "gc",
  "introspect",
  "secrets",
  "create",
  "init",
  "configure",
  "login",
  "logout",
  "macro",
  "ci",
  "snapshot",
  "telemetry",
  "context",
  "lock",
  "d1",
]);

function commandIsMutating(name: string | undefined): boolean {
  if (!name) return false;
  return MUTATING_COMMANDS.has(name);
}

function maybeWriteArtifact(data: unknown): void {
  const path = parseOutputPath(args);
  if (!path) return;
  writeArtifactFile(path, data);
}

interface MergedSelection {
  workersOnly: string[];
  resourcesOnly: string[];
  inputStage?: string;
}

function readSelectionFromInput(): MergedSelection {
  const input = readCommandInput(args);
  if (!input) return { workersOnly: [], resourcesOnly: [] };
  const workers = Array.isArray(input.only) ? input.only.filter((v): v is string => typeof v === "string") : [];
  const resources = Array.isArray(input.onlyResources) ? input.onlyResources.filter((v): v is string => typeof v === "string") : [];
  const stage = typeof input.stage === "string" ? input.stage : undefined;
  return { workersOnly: workers, resourcesOnly: resources, inputStage: stage };
}

function exitWithSandboxBlock(commandName: string, message: string): never {
  const envelope = buildErrorEnvelope(
    Object.assign(new Error(message), {
      agentError: {
        type: "sandbox" as const,
        code: "WD_E_SANDBOX_BLOCKED",
        message,
        retryable: false,
        fix: "Re-run with --dry-run, or unset AGENT_SANDBOX (or omit --sandbox) to allow the mutation.",
      },
    }),
    commandName,
  );
  if (wantsJsonOutput()) {
    printJson(envelope);
  } else {
    console.error(`\n  ✗ ${commandName} blocked [WD_E_SANDBOX_BLOCKED]\n\n  ${message}\n`);
  }
  process.exit(2);
}

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
      throw AgentErrors.validation(`Invalid --${flagName} value "${entry}". Use key=value.`, `Pass --${flagName} key=value pairs.`, { flag: `--${flagName}` });
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

function printNextActions(actions: string[]): void {
  if (actions.length === 0 || wantsJsonOutput()) return;
  console.log("  Next:");
  for (const action of actions) console.log(`    - ${action}`);
  console.log("");
}

const OFFICIAL_REACT_TEMPLATE_SOURCE = "github:cloudflare/templates";
const OFFICIAL_REACT_TEMPLATE_NAME = "vite-react-template";

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const skipDirs = new Set([".git", "node_modules", ".wrangler"]);
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) out.push(fullPath.slice(dir.length + 1));
    }
  }
  return out.sort();
}

function tryScaffoldReactViaCreateCloudflare(targetDir: string, nonInteractive: boolean): { ok: true; files: string[] } | { ok: false; reason: string } {
  const parentDir = dirname(targetDir);
  const projectDirName = basename(targetDir);
  mkdirSync(parentDir, { recursive: true });
  const cmd = "npx";
  const argv = [
    "--yes",
    "create-cloudflare@latest",
    projectDirName,
    "--category=web-framework",
    "--framework=react",
    "--platform=workers",
    "--variant=react-ts",
    "--lang=ts",
    "--no-git",
    "--no-deploy",
    ...(nonInteractive ? ["--accept-defaults"] : []),
  ];
  try {
    execFileSync(cmd, argv, { cwd: parentDir, stdio: wantsJsonOutput() ? "pipe" : "inherit" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `create-cloudflare failed: ${message}` };
  }
  if (!existsSync(targetDir)) {
    return { ok: false, reason: "create-cloudflare reported success but target directory was not created" };
  }
  const expectedReactFiles = [
    "vite.config.ts",
    "index.html",
    "package.json",
  ];
  const looksReact = expectedReactFiles.every((relPath) => existsSync(join(targetDir, relPath)));
  if (!looksReact) {
    rmSync(targetDir, { recursive: true, force: true });
    return { ok: false, reason: "create-cloudflare completed but did not scaffold the expected React + Vite project shape" };
  }
  return { ok: true, files: listFilesRecursive(targetDir) };
}

function normalizeProjectNameFromDir(targetDir: string): string {
  return basename(targetDir)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase() || "my-worker";
}

function migrateReactTemplateForWranglerDeploy(targetDir: string): string[] {
  const changed: string[] = [];

  const wdConfigPath = join(targetDir, "wrangler-deploy.config.ts");
  if (!existsSync(wdConfigPath)) {
    writeFileSync(
      wdConfigPath,
      `import { defineConfig } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: ["."],
  resources: {},
  stages: {
    production: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
});
`,
    );
    changed.push("wrangler-deploy.config.ts");
  }

  const packageJsonPath = join(targetDir, "package.json");
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      name?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const projectName = normalizeProjectNameFromDir(targetDir);
    if (!pkg.name || pkg.name === "vite-react-template") {
      pkg.name = projectName;
    }
    pkg.scripts ??= {};
    pkg.devDependencies ??= {};
    pkg.scripts.wd ??= "wd";
    pkg.scripts.plan ??= "wd plan --stage staging";
    pkg.scripts.apply ??= "wd apply --stage staging";
    pkg.scripts.status ??= "wd status --stage staging";
    pkg.scripts["deploy:stage"] ??= "wd deploy --stage staging";
    pkg.devDependencies["wrangler-deploy"] ??= "^1.5.0";
    writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
    changed.push("package.json");
  }

  return changed;
}

function selectConfigWorkers(config: Awaited<ReturnType<typeof loadConfig>>, selectedWorkers: string[]) {
  const workerSet = new Set(selectedWorkers);
  return {
    ...config,
    workers: config.workers.filter((workerPath: string) => workerSet.has(workerPath)),
    deployOrder: config.deployOrder?.filter((workerPath: string) => workerSet.has(workerPath)),
    serviceBindings: Object.fromEntries(
      Object.entries(config.serviceBindings ?? {})
        .filter(([workerPath]) => workerSet.has(workerPath))
        .map(([workerPath, bindings]) => [
          workerPath,
          Object.fromEntries(
            Object.entries(bindings as Record<string, string>).filter(([, target]) => workerSet.has(target)),
          ),
        ]),
    ),
    secrets: config.secrets
      ? Object.fromEntries(Object.entries(config.secrets).filter(([workerPath]) => workerSet.has(workerPath)))
      : undefined,
    resources: Object.fromEntries(
      Object.entries(config.resources).map(([resourceName, resource]) => {
        const bindings = Object.fromEntries(
          Object.entries((resource as { bindings?: Record<string, unknown> }).bindings ?? {})
            .filter(([workerPath]) => workerSet.has(workerPath)),
        );
        return [resourceName, { ...(resource as object), bindings }];
      }),
    ),
  };
}

function selectConfigResources(config: Awaited<ReturnType<typeof loadConfig>>, selectors: string[]) {
  if (selectors.length === 0) return config;
  const selected = Object.entries(config.resources).filter(([name, resource]) =>
    selectors.includes(name) || selectors.includes((resource as { type: string }).type),
  );
  return {
    ...config,
    resources: Object.fromEntries(selected),
  };
}

function maybeRecordTelemetry(rootDir: string, enabled: boolean, commandName: string, startedAtMs: number): void {
  if (!enabled) return;
  const path = resolve(rootDir, ".wrangler-deploy", "telemetry.ndjson");
  mkdirSync(resolve(rootDir, ".wrangler-deploy"), { recursive: true });
  const durationMs = Date.now() - startedAtMs;
  appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), command: commandName, durationMs })}\n`);
}

function macrosPath(rootDir: string): string {
  return resolve(rootDir, ".wrangler-deploy", "macros.json");
}

function readMacros(rootDir: string): Record<string, string[]> {
  const path = macrosPath(rootDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

function writeMacros(rootDir: string, macros: Record<string, string[]>): void {
  const path = macrosPath(rootDir);
  mkdirSync(resolve(rootDir, ".wrangler-deploy"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(macros, null, 2)}\n`);
}

function lastErrorPath(rootDir: string): string {
  return resolve(rootDir, ".wrangler-deploy", "last-error.json");
}

function runWranglerVersion(): string {
  const raw = execFileSync("npx", ["wrangler", "--version"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const match = raw.match(/wrangler\s+([\d.]+)/i);
  return match?.[1] ?? raw.split("\n")[0]?.trim() ?? raw;
}

function summarizeWranglerWhoami(raw: string): string {
  const text = raw.replace(/\[[0-9;]*m/g, "");
  const lines = text.split(/\r?\n/);
  let email: string | undefined;
  let accountName: string | undefined;
  let accountId: string | undefined;
  for (const line of lines) {
    if (!email) {
      const emailMatch = line.match(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/);
      if (emailMatch) email = emailMatch[0];
    }
    const accountMatch = line.match(/^\s*│?\s*(.+?)\s+│\s+([a-f0-9]{32})\s*│?\s*$/i)
      ?? line.match(/^\s*\|\s*(.+?)\s+\|\s+([a-f0-9]{32})\s*\|\s*$/i);
    if (accountMatch && !accountId) {
      accountName = (accountMatch[1] ?? "").trim();
      accountId = (accountMatch[2] ?? "").trim();
    }
  }
  if (email && accountId) {
    return `${email} (account ${accountName ?? accountId})`;
  }
  if (email) return email;
  if (accountId) return `account ${accountName ?? accountId}`;
  const firstNonBanner = lines.find((line) => line.trim() && !line.includes("wrangler") && !line.includes("─"));
  return firstNonBanner?.trim() ?? "authenticated";
}

function runWranglerWhoami(): string {
  const raw = execFileSync("npx", ["wrangler", "whoami"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return summarizeWranglerWhoami(raw);
}

function releaseSnapshotPath(rootDir: string, stage: string): string {
  return resolve(rootDir, ".wrangler-deploy", `release-snapshot-${stage}.json`);
}

function lockPath(rootDir: string, stage: string): string {
  return resolve(rootDir, ".wrangler-deploy", "locks", `${stage}.json`);
}

function readDeployLock(rootDir: string, stage: string): { stage: string; owner: string; createdAt: string } | null {
  const path = lockPath(rootDir, stage);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as { stage: string; owner: string; createdAt: string };
}

function writeDeployLock(rootDir: string, stage: string): { stage: string; owner: string; createdAt: string } {
  const lock = {
    stage,
    owner: process.env.GITHUB_ACTOR ?? process.env.USER ?? "unknown",
    createdAt: new Date().toISOString(),
  };
  const path = lockPath(rootDir, stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

function clearDeployLock(rootDir: string, stage: string): void {
  const path = lockPath(rootDir, stage);
  if (existsSync(path)) rmSync(path, { force: true });
}

function summarizeEnvDiff(baseText: string, renderedText: string): { baseLines: number; renderedLines: number; changedLines: number } {
  const base = baseText.split("\n");
  const rendered = renderedText.split("\n");
  const max = Math.max(base.length, rendered.length);
  let changed = 0;
  for (let i = 0; i < max; i += 1) {
    if ((base[i] ?? "") !== (rendered[i] ?? "")) changed += 1;
  }
  return { baseLines: base.length, renderedLines: rendered.length, changedLines: changed };
}

function parseStatusOutputMode(): "text" | "json" | "ndjson" {
  const mode = getFlag("output");
  if (mode === "json" || mode === "ndjson" || mode === "text") return mode;
  if (wantsJsonOutput()) return "json";
  return "text";
}

function detectChangedWorkers(rootDir: string, workers: string[]): string[] {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim();
    if (!output) return [];
    const files = output.split("\n").filter(Boolean);
    return workers.filter((workerPath) => files.some((file) => file === workerPath || file.startsWith(`${workerPath}/`)));
  } catch {
    return [];
  }
}

async function loadConfig(rootDir: string) {
  const configPath = resolve(rootDir, "wrangler-deploy.config.ts");
  if (!existsSync(configPath)) {
    // Try .js
    const jsPath = resolve(rootDir, "wrangler-deploy.config.js");
    if (!existsSync(jsPath)) {
      throw AgentErrors.config(
        "No wrangler-deploy.config.ts or wrangler-deploy.config.js found in the current directory.",
        "Run `wd init` to scaffold a config, or `cd` to a project that has one.",
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

function resolveRootDir(): string {
  const cwdFlag = getFlag("cwd");
  if (cwdFlag) {
    const target = resolve(process.cwd(), cwdFlag);
    if (!existsSync(target)) {
      throw AgentErrors.notFound(`--cwd directory does not exist: ${target}`, "Pass an existing directory path with --cwd.");
    }
    return target;
  }
  return process.cwd();
}

async function main() {
  const commandStartedAt = Date.now();
  const rootDir = resolveRootDir();

  const envFileResult = loadEnvFileFromArgs(args, rootDir);
  if (envFileResult) {
    if (!isQuiet() && !wantsJsonOutput()) {
      console.log(`  loaded ${envFileResult.loaded} vars from ${envFileResult.path}`);
    }
  } else {
    const candidates = [".env", ".env.local"];
    for (const file of candidates) {
      const fullPath = resolve(rootDir, file);
      if (existsSync(fullPath)) {
        try {
          const { loadEnvFile } = await import("../core/dotenv.js");
          const result = loadEnvFile(fullPath);
          if (!isQuiet() && !wantsJsonOutput() && result.errors.length === 0) {
            const count = Object.keys(result.values).length;
            console.log(`  loaded ${count} vars from ${file}`);
          }
        } catch {
          // skip unreadable files
        }
        break;
      }
    }
  }

  const profileSelection = resolveProfileSelection(args);
  const isProfileCommand =
    command === "configure" ||
    command === "login" ||
    command === "logout" ||
    command === "profile" ||
    command === "util";
  if (!isProfileCommand) {
    applyProfileToEnv(profileSelection.name);
  }

  const projectContext = loadProjectContext(rootDir);
  const projectContextDetails = loadProjectContextDetails(rootDir);

  if (command === "--version" || command === "version") {
    const cliDir = fileURLToPath(new URL(".", import.meta.url));
    const pkgPath = resolve(cliDir, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
    if (wantsJsonOutput()) {
      printJson({
        package: pkg.name ?? "wrangler-deploy",
        version: pkg.version ?? "0.0.0",
        manifestVersion: cliManifest.version,
        binaryPath: process.argv[1] ?? null,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        sandbox: isSandboxMode(),
        timestamp: new Date().toISOString(),
      });
      return;
    }
    console.log(`wrangler-deploy ${pkg.version ?? "0.0.0"}`);
    return;
  }

  if (!command || command === "help" || command === "--help") {
    if (outputFormat === "json") {
      printJson(cliManifest);
      return;
    }

    // Beginner-friendly first-run guide: detect when there's no project here yet
    // and show a focused, three-step start instead of the firehose of commands.
    const cwd = process.cwd();
    const hasProjectConfig = existsSync(resolve(cwd, "wrangler-deploy.config.ts"))
      || existsSync(resolve(cwd, "wrangler-deploy.config.js"));
    if (!hasProjectConfig && command !== "help" && !args.includes("--all")) {
      const hasWranglerConfig = existsSync(resolve(cwd, "wrangler.jsonc"))
        || existsSync(resolve(cwd, "wrangler.json"))
        || existsSync(resolve(cwd, "workers"));
      console.log(`
  wrangler-deploy — get a Cloudflare Workers project from zero to deployed.

  No \`wrangler-deploy.config.ts\` here yet — start with one of these:

    ${hasWranglerConfig
      ? "wd init                Generate a config from existing wrangler.jsonc files"
      : "wd create vite <name>  Scaffold a starter project (recommended for beginners)"}
    wd login               Save Cloudflare credentials (if you haven't already)
    wd doctor              Check that wrangler + auth are ready

  Once you have a config, the happy path is:

    wd plan                Preview what would be created
    wd apply               Provision Cloudflare resources for your stage
    wd deploy              Deploy your workers
    wd status              See what's live

  Run \`wd help --all\` for the full command list, or \`wd <command> --help\` for details.
`);
      return;
    }

    console.log(`
  wrangler-deploy — Wrangler-native environment orchestration

  Quick start:
    wd configure           Set up Cloudflare authentication
    wd context set --stage dev   Set default stage
    wd plan                Preview what will be created
    wd apply               Provision resources
    wd deploy              Deploy workers
    wd status              Verify everything is live

  Core commands (aliases):
    plan (p)               Show what would be created/changed
    apply (a)              Provision resources and generate configs
    deploy (d)             Deploy workers using rendered configs
    rollback               Roll back worker to a specific version
    history                Show deployment/rollback history for a stage
    env diff               Diff local wrangler config vs rendered stage config
    lock                   Manage stage deploy locks
    destroy (des)          Tear down all resources for a stage
    status (s)             Show stage status and deployment URLs
    check                  Combined doctor + plan preflight checks
    quickstart             Print first-run command sequence
    release-note           Summarize stage changes since last marked success
    init (i)               Generate wrangler-deploy.config.ts from existing configs
    create                 Scaffold a new starter project
    verify (ver)           Post-deploy coherence check
    graph (g)              Show topology as ascii/mermaid/dot
    diff                   Compare two stages
    impact                 Show dependency impact for a worker

  Development:
    dev                    Start local dev servers (no stage needed)
    dev doctor             Validate local dev setup
    dev ui                 Start a local runtime dashboard
    open                   Open deployed worker URL in browser
    dashboard              Open Cloudflare dashboard in browser
    replay                 Replay captured HTTP requests against local worker
    logs                   Tail persisted dev logs
    cron trigger/loop      Trigger local scheduled handlers
    snapshot list/save/load Manage local runtime snapshots

  Stage management:
    status --web           Web UI for deployed stages
    state list/get/tree    Inspect managed resources
    secrets                Check/set/sync secrets
    gc                     Garbage collect expired stages
    run                    Read-only config validation + state summary
    rotate-password        Re-encrypt state with new password

  Infrastructure:
    d1 list/inspect/exec/seed/reset   D1 database operations
    d1 migrate status      Show local D1 migration status
    queue list/inspect/send/replay/tail   Queue operations
    queue dlq list/retry/drop  Dead-letter queue helpers
    route verify/apply     Validate and preview route configuration
    worker call/routes    Worker interaction

  CI/CD:
    ci init                Generate GitHub Actions workflow
    ci comment             Post/update PR comment with deploy status
    ci check               Post GitHub check run

  Account & profiles:
    configure              Set up a profile (api-token or oauth)
    login                  Save Cloudflare API token
    logout                 Remove saved credentials
    profile list           List configured profiles
    telemetry on/off/status Toggle local command telemetry
    util create-cf-token   Print scopes + dashboard URL for token creation

  Usage guard:
    guard init/deploy/migrate    Provision guard Worker
    guard status/breaches/report  Monitor Workers usage
    guard disarm/arm/approvals    Runtime protection

  Other:
    doctor (doc)           Run diagnostic checks
    explain                Explain common error messages/codes
    introspect             Scan live account, generate config from existing resources
    completions            Generate shell completions
    context                Show/set/wdrc project defaults
    macro                  Save/list/run command macros
    onboard                First-run setup helper for new developers

  Options:
    --stage <name>         Stage (default: \$USER, or stage in .wdrc)
    --profile <name>       Profile (default: WD_PROFILE / CLOUDFLARE_PROFILE)
    --cwd <path>           Use a different project directory
    --env-file <path>      Load env vars from file (auto-detects .env otherwise)
    --quiet, -q            Suppress non-error output
    --json                 Machine-readable JSON output
    --dry-run              Preview without making changes
    --force                Re-apply lifecycle / override stage protection
    --watch                Re-run on file changes
    --diff                 Show delta since last status tick
    --strict               Fail on warnings (doctor)
    --only <worker>        Scope command to one/more workers (repeatable)
    --only-resources <name|type> Scope plan/apply resources (repeatable)
    --since <interval>     Filter logs by relative time (e.g. 10m)
    --interval-ms <ms>     Poll interval for status --watch
    --open                 Open deployed URL after deploy
    --dashboard            Open dashboard URL after deploy
    --print-url            Print URL and exit (no browser)
    --copy                 Copy URL to clipboard
    --latest               Use last deployed worker by default
    --changed              Scope deploy to git-changed workers
    --lock                 Acquire stage lock before deploy
    --canary <percent>     Canary rollout hint (records intent in output)
    --summary              Compact status output
    --cost-hint            Add resource cost hints in plan output
    --plan-only            Show deploy actions without deploying
    --tail <n>             Limit logs output to last n lines
    --grep-json <key>      Filter JSON log lines by top-level key
    --fail-on-drift        Exit non-zero when stage status shows drift
    --output <mode>        text|json|ndjson for status output
    --error-code <code>    Explain a WD_E_* code
    --versioned            Versioned schema envelope (schema command)
    --no-open              Disable browser opening
    --verify               Run post-deploy verification
    --filter <worker>      Filter dev/deploy to one worker
    --session              Single multi-config local dev session
    --tunnel [worker|all]  Expose local dev via tunnel
    --base-port <number>  Base port for wd dev
    --fallback-stage <name>  Fallback stage for dev filter read mode
    --persist-to <path>   Persist Miniflare state for dev session
    --pack <name>         Run a named verify-local pack
    --state-password      Encrypt/decrypt state
    --erase-secrets       Clear encrypted secrets from state (apply --force)
    --database-url <url>  Postgres URL for Hyperdrive (apply)
    --account-id <id>     Cloudflare account ID override
    --fields <paths>      Filter JSON output to dot-paths
    --key <name>          Key for wd context get

  Project defaults (.wdrc):
    stage, accountId, basePort, filter, session, persistTo,
    databaseUrl, statePassword

  Examples:
    wd init
    wd create vite my-app
    wd plan --stage staging
    wd apply --stage staging --database-url "postgresql://..."
    wd deploy --stage staging
    wd destroy --stage pr-123
    wd status
    wd context set --stage staging --account-id 1234...
`);
    return;
  }

  const explicitStage = getFlag("stage");

  // Short aliases (resolve before config loading since we need the resolved command name)
  const aliasMap: Record<string, string | undefined> = {
    d: "deploy", p: "plan", a: "apply", s: "status",
    i: "init", g: "graph", gc: "gc",
    des: "destroy", ver: "verify", doc: "doctor",
    conf: "configure", prof: "profile",
  };
  const resolvedCommand = aliasMap[command] ?? command;
  if (resolvedCommand !== command && !isQuiet() && !wantsJsonOutput()) {
    console.log(`  (alias: ${command} -> ${resolvedCommand})`);
  }

  // Per-command help: `wd <command> --help` (or -h) must short-circuit before
  // any side-effecting work (auth, config load, sandbox guard, dispatch).
  // The top-level help block above only matches `wd help` / `wd --help`; this
  // handles the per-command form so e.g. `wd deploy --help` doesn't deploy.
  if (args.includes("--help") || args.includes("-h")) {
    const entry = cliManifest.commands.find((c) => c.name === resolvedCommand);
    const exampleSet = getExamples(resolvedCommand);
    if (wantsJsonOutput()) {
      printJson({
        command: resolvedCommand,
        manifest: entry ?? null,
        examples: exampleSet?.examples ?? [],
      });
      return;
    }
    if (!entry) {
      console.log(`\n  Unknown command: ${resolvedCommand}\n  Run \`wd help\` for the full list.\n`);
      return;
    }
    const traits = [
      entry.mutating ? "mutating" : null,
      entry.requiresAuth ? "requires-auth" : null,
      entry.requiresStage ? "requires-stage" : null,
      entry.network ? "network" : null,
      entry.writesFiles ? "writes-files" : null,
      entry.supportsDryRun ? "supports --dry-run" : null,
    ].filter(Boolean);
    console.log(`\n  wd ${entry.name} — ${entry.description}\n`);
    if (entry.subcommands?.length) {
      console.log(`  Subcommands: ${entry.subcommands.join(", ")}`);
    }
    if (entry.flags?.length) {
      console.log(`  Flags: ${entry.flags.join(" ")}`);
    }
    if (traits.length) {
      console.log(`  Traits: ${traits.join(", ")}`);
    }
    if (exampleSet?.examples.length) {
      console.log(`\n  Examples:`);
      for (const ex of exampleSet.examples) {
        console.log(`    ${ex.description}`);
        console.log(`      $ ${ex.command}`);
      }
    }
    console.log(`\n  Run \`wd examples --command ${resolvedCommand}\` for more, or \`wd help\` for all commands.\n`);
    return;
  }

  // Load config early to read its stage field (beats .wdrc and $USER)
  let configStage: string | undefined;
  const isConfigCommand = ["plan", "apply", "deploy", "destroy", "status", "open", "dashboard", "output",
    "graph", "diff", "impact", "verify", "secrets", "run", "state", "worker", "d1", "queue",
    "cron", "logs", "snapshot", "fixture", "doctor", "check", "rollback", "history", "env", "route", "lock",
    "replay", "onboard", "quickstart", "release-note"].includes(resolvedCommand);
  if (isConfigCommand) {
    try {
      const cfg = await loadConfig(rootDir);
      configStage = cfg.stage;
    } catch {
      // config not available — will be caught by the command case
    }
  }

  const envStage = process.env.WD_STAGE;
  const stage = explicitStage ?? configStage ?? projectContext.stage ?? envStage ?? defaultUserStage();
  if (!explicitStage && !projectContext.stage && !isQuiet() && !wantsJsonOutput() && command !== "dev") {
    const source = configStage ? "config" : process.env.WD_STAGE ? "WD_STAGE env" : "$USER";
    console.log(`  stage: ${stage} (from ${source}, use --stage to override)`);
  }

  if (commandIsMutating(resolvedCommand)) {
    const sandboxDecision = enforceSandboxGuard(`wd ${resolvedCommand}`, {
      mutating: true,
      dryRun: isDryRun(args),
    });
    if (sandboxDecision.blocked) {
      exitWithSandboxBlock(`wd ${resolvedCommand}`, sandboxDecision.message ?? "Sandbox refusal");
    }
  }

  // Manifest-driven prerequisite enforcement.
  const manifestEntry = cliManifest.commands.find((c) => c.name === resolvedCommand);
  // Subcommands that only read state/locally don't need Cloudflare auth.
  const readOnlySubcommandPairs = new Set([
    "rollback list",
    "route verify",
    "secrets",
    "guard status",
    "guard breaches",
    "guard report",
    "guard approvals",
  ]);
  const subcommandKey = `${resolvedCommand} ${args[1] ?? ""}`.trim();
  const isReadOnlySubcommand = readOnlySubcommandPairs.has(subcommandKey) || readOnlySubcommandPairs.has(resolvedCommand ?? "");
  if (manifestEntry?.requiresAuth && !isDryRun(args) && !isReadOnlySubcommand) {
    const hasToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
    const hasAccount = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID || projectContext.accountId);
    // Env-var path is the explicit, machine-readable case (CI, agents). For
    // beginners who ran `wrangler login`, we fall back to whatever Wrangler
    // knows — `wrangler whoami` exits 0 only if it has working credentials
    // and can resolve an account. That avoids the trap where a freshly
    // logged-in user runs `wd deploy` and gets told they're not authed.
    if (!hasToken || !hasAccount) {
      let wranglerOk = false;
      try {
        runWranglerWhoami();
        wranglerOk = true;
      } catch {
        wranglerOk = false;
      }
      if (!wranglerOk) {
        const missing = [
          ...(!hasToken ? ["CLOUDFLARE_API_TOKEN"] : []),
          ...(!hasAccount ? ["CLOUDFLARE_ACCOUNT_ID"] : []),
        ];
        const commandName = `wd ${resolvedCommand}`;
        const message = `${commandName} requires Cloudflare auth. Missing: ${missing.join(", ")}.`;
        const envelope = buildErrorEnvelope(
          Object.assign(new Error(message), {
            agentError: {
              type: "auth" as const,
              code: "WD_E_AUTH_FAILED",
              message,
              retryable: false,
              fix: "Run `wrangler login` (or `wd login`), or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.",
              expected: { env: missing },
            },
          }),
          commandName,
        );
        if (wantsJsonOutput()) {
          printJson(envelope);
        } else {
          console.error(`\n  ✗ ${commandName} failed [WD_E_AUTH_FAILED]\n\n  ${message}\n  Fix: ${envelope.error.fix}\n`);
        }
        process.exit(1);
      }
    }
  }
  if (manifestEntry?.requiresStage && !explicitStage && !configStage && !projectContext.stage && !process.env.WD_STAGE) {
    if (!wantsJsonOutput() && !isQuiet()) {
      console.log(`  tip: --stage not set — using "${stage}" (your username). Pin a default with \`wd context set --stage ${stage}\`.`);
    }
  }

  switch (resolvedCommand) {
    case "init": {
      const preset = getFlag("preset");
      let output: string;
      if (preset === "minimal") {
        output = `import { defineConfig } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: ["."],
  resources: {},
  stages: { dev: { protected: false }, production: { protected: true } },
});
`;
      } else if (preset === "infra-only") {
        output = `import { defineConfig } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: [],
  resources: {},
  stages: { dev: { protected: false }, production: { protected: true } },
});
`;
      } else if (preset === "monorepo") {
        output = `import { defineConfig } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: ["apps/api", "apps/worker"],
  resources: {},
  stages: { dev: { protected: false }, staging: { protected: true }, production: { protected: true } },
});
`;
      } else {
        output = generateConfig(rootDir);
      }
      const outPath = join(rootDir, "wrangler-deploy.config.ts");
      const dryRun = isDryRun(args);
      const exists = existsSync(outPath);
      if (exists && !hasFlag("force") && !dryRun) {
        const message = `wrangler-deploy.config.ts already exists. Pass --force to overwrite, or use a different directory.`;
        if (wantsJsonOutput()) {
          printJson({ ok: false, command: "wd init", error: { type: "validation", code: "WD_E_VALIDATION", message, retryable: false, fix: "Re-run with --force or change directory." } });
        } else {
          console.error(`  ${message}`);
        }
        process.exit(1);
      }
      if (dryRun) {
        const result = {
          ok: true,
          dryRun: true,
          path: outPath,
          preset: preset ?? null,
          bytes: Buffer.byteLength(output, "utf-8"),
          wouldOverwrite: exists,
          preview: output,
        };
        if (wantsJsonOutput()) {
          printJson(result);
        } else {
          console.log(`\n  [dry-run] Would write wrangler-deploy.config.ts (${result.bytes} bytes)\n`);
          if (exists) console.log(`  ! existing file would be overwritten with --force\n`);
        }
        maybeWriteArtifact(result);
        break;
      }
      writeFileSync(outPath, output);
      const result = { ok: true, path: outPath, preset: preset ?? null, bytes: Buffer.byteLength(output, "utf-8") };
      if (wantsJsonOutput()) {
        printJson(result);
        maybeWriteArtifact(result);
        break;
      }
      console.log(`\n  Generated wrangler-deploy.config.ts from ${rootDir}\n`);
      console.log(`  Next:\n`);
      console.log(`    wd context set --stage <name>   Set default stage`);
      console.log(`    wd plan                        Preview what will be created`);
      console.log(`    wd apply                       Provision resources`);
      console.log(`    wd deploy                      Deploy workers`);
      console.log(`    wd status                      Verify everything is live\n`);
      break;
    }

    case "create": {
      const template = args[1];
      if (template === "vibe-rules") {
        const targetsValue = getFlag("targets") ?? args[2] ?? "claude-code";
        const targets = parseVibeTargets(targetsValue);
        if (targets.length === 0) {
          throw AgentErrors.validation(
            `Specify targets via --targets or as the second arg. Examples: claude-code, cursor, all`,
            "Pass --targets <claude-code|cursor|all> or supply a target as the second argument.",
            { flag: "--targets" },
          );
        }
        const result = writeVibeRules({
          targetDir: rootDir,
          targets,
          force: hasFlag("force"),
        });
        if (wantsJsonOutput()) {
          printJson({ ...result, targets });
          break;
        }
        console.log(`\n  wrangler-deploy create vibe-rules\n`);
        for (const file of result.files) console.log(`  ✓ ${file}`);
        for (const file of result.skipped) console.log(`  · ${file} (exists, pass --force to overwrite)`);
        console.log("");
        break;
      }

      // Parse positionals: first non-flag arg is the directory unless it
      // matches a known template name. Allows both `wd create my-app vite`
      // and `wd create vite my-app`.
      const KNOWN_INLINE_TEMPLATES = new Set(["hello"]);
      const positionals: string[] = [];
      for (let i = 1; i < args.length; i += 1) {
        const arg = args[i]!;
        if (arg.startsWith("--")) {
          if (arg.includes("=")) continue;
          const next = args[i + 1];
          if (next !== undefined && !next.startsWith("--")) i += 1;
          continue;
        }
        positionals.push(arg);
      }

      const templateFlag = getFlag("template");
      const exampleFlag = getFlag("example"); // arbitrary GitHub source, like create-next-app's --example
      const yesFlag = hasFlag("yes");
      let initialTemplate: string | undefined = templateFlag;
      let initialDir: string | undefined = getFlag("dir");
      const manifestSource = resolveTemplateSource({});
      const manifest = loadTemplateManifest(manifestSource);
      const knownNames = new Set<string>([
        ...KNOWN_INLINE_TEMPLATES,
        ...manifest.templates.map((t) => t.name),
      ]);

      // First positional may be the template name — accept it if recognised.
      // Otherwise treat it as the directory. Order doesn't matter as long as
      // exactly one positional looks like a template.
      for (const p of positionals) {
        if (!initialTemplate && knownNames.has(p)) {
          initialTemplate = p;
        } else if (!initialDir) {
          initialDir = p;
        }
      }

      const nonInteractive = detectNonInteractive() || yesFlag || wantsJsonOutput();
      const picked = await runPicker({
        ...(initialDir !== undefined ? { initialDir } : {}),
        ...(initialTemplate !== undefined ? { initialTemplate } : {}),
        manifest,
        nonInteractive,
      });
      const chosenTemplate = exampleFlag ? "_example" : picked.template;
      const targetDir = picked.dir;

      if (isDryRun(args)) {
        const preview = {
          ok: true,
          dryRun: true,
          template: chosenTemplate,
          example: exampleFlag ?? null,
          targetDir: resolve(rootDir, targetDir),
          projectName: getFlag("name") ?? null,
          wouldOverwrite: existsSync(resolve(rootDir, targetDir)) && hasFlag("force"),
          note: "Pass without --dry-run to actually scaffold.",
        };
        if (wantsJsonOutput()) {
          printJson(preview);
        } else {
          console.log(`\n  [dry-run] Would scaffold ${chosenTemplate} starter into ${preview.targetDir}\n`);
        }
        maybeWriteArtifact(preview);
        break;
      }

      let result: { template: string; targetDir: string; projectName: string; files: string[] };
      const absoluteTargetDir = resolve(rootDir, targetDir);
      if (chosenTemplate === "hello") {
        // Inline path — works offline, zero network, instant.
        result = createHelloStarter({
          targetDir,
          ...(getFlag("name") !== undefined ? { projectName: getFlag("name") } : {}),
          force: hasFlag("force"),
        });
      } else {
        // React path: prefer running official create-cloudflare, then migrate.
        if (chosenTemplate === "react" && !exampleFlag) {
          const c3 = tryScaffoldReactViaCreateCloudflare(absoluteTargetDir, nonInteractive);
          if (c3.ok) {
            const projectName = normalizeProjectNameFromDir(absoluteTargetDir);
            result = {
              template: chosenTemplate,
              targetDir: absoluteTargetDir,
              projectName,
              files: c3.files,
            };
            result.files.push(...migrateReactTemplateForWranglerDeploy(absoluteTargetDir));
          } else {
            if (!wantsJsonOutput()) {
              console.warn(`\n  ! ${c3.reason}`);
              console.warn("  ! Falling back to template fetch from cloudflare/templates.\n");
            }
            const substitutions = deriveSubstitutions(absoluteTargetDir, getFlag("name"));
            const fetched = await fetchTemplate(
              {
                templateName: OFFICIAL_REACT_TEMPLATE_NAME,
                targetDir: absoluteTargetDir,
                source: OFFICIAL_REACT_TEMPLATE_SOURCE,
                force: hasFlag("force"),
              },
              substitutions,
            );
            result = {
              template: chosenTemplate,
              targetDir: absoluteTargetDir,
              projectName: substitutions.projectName!,
              files: fetched.files,
            };
            result.files.push(...migrateReactTemplateForWranglerDeploy(absoluteTargetDir));
          }
        } else {
          // Fetched path — either a manifest template or an arbitrary --example.
        const substitutions = deriveSubstitutions(absoluteTargetDir, getFlag("name"));
        const templateName = chosenTemplate === "_example"
          ? ""
          : chosenTemplate === "react"
            ? OFFICIAL_REACT_TEMPLATE_NAME
            : chosenTemplate;
        const sourceOverride = chosenTemplate === "react"
          ? OFFICIAL_REACT_TEMPLATE_SOURCE
          : exampleFlag;
        const fetched = await fetchTemplate(
          {
            templateName,
            targetDir: absoluteTargetDir,
            ...(sourceOverride !== undefined ? { source: sourceOverride } : {}),
            force: hasFlag("force"),
          },
          substitutions,
        );
        result = {
          template: chosenTemplate === "_example" ? exampleFlag! : chosenTemplate,
          targetDir: absoluteTargetDir,
          projectName: substitutions.projectName!,
          files: fetched.files,
        };
        if (chosenTemplate === "react") {
          result.files.push(...migrateReactTemplateForWranglerDeploy(absoluteTargetDir));
        }
        }
      }

      if (hasFlag("vibe-rules")) {
        const targetsValue = getFlag("vibe-rules") ?? "claude-code";
        const targets = parseVibeTargets(targetsValue === "true" ? "claude-code" : targetsValue);
        const vibeResult = writeVibeRules({
          targetDir: result.targetDir,
          targets,
          force: hasFlag("force"),
        });
        result.files.push(...vibeResult.files);
      }

      // Auto-install dependencies unless opted out. Skipping install means
      // `pnpm dev` won't work — print the alternative so they know.
      const skipInstall = hasFlag("no-install") || wantsJsonOutput();
      let installResult: { ok: boolean; pm: string; exitCode: number | null } | undefined;
      if (!skipInstall) {
        const pm = detectPackageManager();
        console.log(`\n  Created ${result.template} starter in ${result.targetDir}`);
        for (const file of result.files) {
          console.log(`    ✓ ${file}`);
        }
        console.log(`\n  Installing dependencies with ${pm}...\n`);
        installResult = runInstall(result.targetDir, pm);
      }

      if (wantsJsonOutput()) {
        printJson({ ...result, install: installResult ?? { skipped: true } });
        maybeWriteArtifact(result);
        break;
      }

      // `pnpm deploy` is a reserved pnpm command (workspace deploy), so the
      // scaffold's `deploy` script must be invoked as `pnpm run deploy`. Use
      // the `<pm> run …` form for `deploy` everywhere to keep instructions
      // consistent. `dev` is fine to call directly except for npm.
      const pmName = installResult?.pm ?? "pnpm";
      const pmRun = pmName === "npm" ? "npm run dev" : `${pmName} dev`;
      const pmDeploy = pmName === "npm" ? "npm run deploy" : `${pmName} run deploy`;
      const fromHere = targetDir === "." ? "" : `cd ${targetDir} && `;

      if (skipInstall) {
        console.log(`\n  Created ${result.template} starter in ${result.targetDir}\n`);
        for (const file of result.files) console.log(`  ✓ ${file}`);
        console.log(`\n  Next:\n`);
        console.log(`    cd ${targetDir}`);
        console.log(`    pnpm install   # or npm / yarn / bun`);
        console.log(`    pnpm dev\n`);
        if (chosenTemplate === "hello") {
          console.log(`  Then visit http://localhost:8787\n`);
          console.log(`  When you're ready to put it on the edge:`);
          console.log(`    pnpm run deploy   # or npm run deploy / yarn run deploy / bun run deploy\n`);
        }
        break;
      }

      if (!installResult?.ok) {
        console.log(`\n  ⚠ Dependency install exited with code ${installResult?.exitCode}.`);
        console.log(`  Try running it manually:\n`);
        console.log(`    ${fromHere}${installResult?.pm ?? "pnpm"} install\n`);
        break;
      }

      console.log(`\n  ✓ Ready.\n`);
      if (chosenTemplate === "hello") {
        console.log(`  Start dev:`);
        console.log(`    ${fromHere}${pmRun}`);
        console.log(`\n  Then open http://localhost:8787 — you should see JSON.\n`);
        console.log(`  When you're ready to put it on the edge:`);
        console.log(`    ${fromHere}${pmDeploy}\n`);
      } else {
        console.log(`  Start dev:`);
        console.log(`    ${fromHere}${pmRun}\n`);
      }
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
        console.log(`  Next:\n`);
        console.log(`    Review worker paths (names → local directory paths)`);
        console.log(`    wd context set --stage <name>   Set default stage`);
        console.log(`    wd plan                        Preview what will be created`);
        console.log(`    wd apply                       Provision resources`);
        console.log(`    wd deploy                      Deploy workers\n`);
      }
      break;
    }

    case "plan": {
      assertStage(stage);
      const baseConfig = await loadConfig(rootDir);
      const inputSelection = readSelectionFromInput();
      const workersOnly = [...getFlags("only"), ...inputSelection.workersOnly];
      const resourcesOnly = [...getFlags("only-resources"), ...inputSelection.resourcesOnly];
      const configScopedWorkers = workersOnly.length > 0 ? selectConfigWorkers(baseConfig, workersOnly) : baseConfig;
      const config = resourcesOnly.length > 0 ? selectConfigResources(configScopedWorkers, resourcesOnly) : configScopedWorkers;
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const result = await plan({ stage }, { rootDir, config, state: stateProvider });

      if (wantsJsonOutput()) {
        printJson(result);
        maybeWriteArtifact(result);
        break;
      }
      maybeWriteArtifact(result);

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
        if (hasFlag("cost-hint")) {
          const hint =
            item.type === "d1" ? "stateful DB changes can impact data lifecycle"
              : item.type === "queue" ? "message durability/consumer concurrency may affect cost"
                : item.type === "r2" ? "storage and egress may scale with traffic"
                  : item.type === "kv" ? "read/write volume drives usage"
                    : "review resource-specific Cloudflare pricing";
          console.log(`    cost-hint: ${hint}`);
        }
        if (hasFlag("explain")) {
          console.log(`    explain: ${item.action} because desired config differs from current stage state.`);
        }
      }

      const created = result.items.filter((i) => i.action === "create").length;
      const synced = result.items.filter((i) => i.action === "in-sync").length;
      const drifted = result.items.filter((i) => i.action === "drifted").length;
      const orphaned = result.items.filter((i) => i.action === "orphaned").length;
      console.log(
        `\n  ${created} to create, ${synced} in sync, ${drifted} drifted, ${orphaned} orphaned\n`,
      );
      if (created + drifted + orphaned === 0) {
        printNextActions([
          `wd deploy --stage ${stage}`,
          `wd status --stage ${stage}`,
        ]);
      } else {
        printNextActions([`wd apply --stage ${stage}`]);
      }
      maybeRecordTelemetry(rootDir, !!projectContext.telemetry, "plan", commandStartedAt);
      break;
    }

    case "apply": {
      assertStage(stage);
      const baseConfig = await loadConfig(rootDir);
      const inputSelection = readSelectionFromInput();
      const workersOnly = [...getFlags("only"), ...inputSelection.workersOnly];
      const resourcesOnly = [...getFlags("only-resources"), ...inputSelection.resourcesOnly];
      const configScopedWorkers = workersOnly.length > 0 ? selectConfigWorkers(baseConfig, workersOnly) : baseConfig;
      const config = resourcesOnly.length > 0 ? selectConfigResources(configScopedWorkers, resourcesOnly) : configScopedWorkers;
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
          maybeWriteArtifact(result);
        } else {
          maybeWriteArtifact(result);
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

      const runApply = async () => {
        const liveBaseConfig = await loadConfig(rootDir);
        const liveScopedWorkers = workersOnly.length > 0 ? selectConfigWorkers(liveBaseConfig, workersOnly) : liveBaseConfig;
        const liveConfig = resourcesOnly.length > 0 ? selectConfigResources(liveScopedWorkers, resourcesOnly) : liveScopedWorkers;
        const password = resolveStatePassword(liveConfig, projectContext);
        const liveState = resolveStateProvider(rootDir, liveConfig.state, password);

        if (hasFlag("erase-secrets")) {
          if (!hasFlag("force")) {
            throw AgentErrors.validation("--erase-secrets requires --force (this is a destructive recovery path)", "Pass --force together with --erase-secrets.", { flag: "--force" });
          }
          const existing = await liveState.read(stage);
          if (existing) {
            const erased = eraseSecrets(existing);
            await liveState.write(stage, erased);
            if (!wantsJsonOutput()) console.log(`  · erased encrypted secrets from state for ${stage}\n`);
          }
        }

        return apply(
          {
            stage,
            databaseUrl: getFlag("database-url") ?? projectContext.databaseUrl,
            force: hasFlag("force"),
          },
          { rootDir, config: liveConfig, state: liveState, wrangler, logger: wantsJsonOutput() ? silentLogger : console },
        );
      };

      if (hasFlag("interactive")) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
        try {
          const proceed = (await question(`Apply stage "${stage}" now? [y/N]: `)).trim().toLowerCase();
          if (!["y", "yes"].includes(proceed)) {
            console.log("  cancelled");
            break;
          }
        } finally {
          rl.close();
        }
      }

      const result = await runApply();
      if (wantsJsonOutput()) {
        printJson(result);
        maybeWriteArtifact(result);
      } else {
        maybeWriteArtifact(result);
        printNextActions([`wd deploy --stage ${stage}`, `wd status --stage ${stage}`]);
      }
      maybeRecordTelemetry(rootDir, !!projectContext.telemetry, "apply", commandStartedAt);

      if (hasFlag("watch")) {
        const targets = resolveWatchTargets(rootDir, config.workers ?? []);
        console.log(`\n  watching ${targets.length} files for changes (Ctrl+C to stop)\n`);
        const watcher = startWatch({
          paths: targets,
          onChange: async () => {
            try {
              console.log(`\n  config change detected — re-applying...\n`);
              await runApply();
            } catch (error) {
              console.error(`\n  apply failed: ${(error as Error).message}\n`);
            }
          },
        });
        const shutdown = () => { watcher.close(); process.exit(0); };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        await new Promise(() => {});
      }
      break;
    }

    case "secrets": {
      const subCommand = args[1]; // set, sync, or undefined (defaults to check)

      if (subCommand === "sync") {
        const syncMode = args[2] && !args[2].startsWith("--") ? args[2] : "push";
        if (syncMode === "pull") {
          assertStage(stage, "wd secrets sync pull");
          const config = await loadConfig(rootDir);
          const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
          const state = await stateProvider.read(stage);
          if (!state) throw AgentErrors.state(`No state for stage "${stage}".`, `Run \`wd apply --stage ${stage}\` first.`);
          const declared = Object.entries(config.secrets ?? {}).flatMap(([workerPath, names]) =>
            (names as Array<string | { name: string }>).map((name) =>
              `${workerPath}/${typeof name === "string" ? name : name.name}`
            )
          );
          const template = declared.map((key) => `${key.split("/").slice(1).join("/")}=`);
          if (wantsJsonOutput()) printJson({ stage, mode: "pull", declared, template });
          else {
            console.log(`\n  secrets sync pull (${stage})\n`);
            for (const line of template) console.log(`  ${line}`);
            console.log("");
          }
          break;
        }
        // wrangler-deploy secrets sync --to <stage> --from-env-file <path>
        const toStage = getFlag("to") ?? stage;
        const envFile = getFlag("from-env-file") ?? getFlag("from") ?? ".env";
        if (!toStage) throw AgentErrors.validation("--to is required for secrets sync.", "Pass --to <stage>.", { flag: "--to" });
        if (!envFile) throw AgentErrors.validation("--from-env-file is required for secrets sync", "Pass --from-env-file <path>.", { flag: "--from-env-file" });
        const config = await loadConfig(rootDir);
        const wrangler = createWranglerRunner();
        const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));

        if (isDryRun(args)) {
          const state = await stateProvider.read(toStage);
          if (!state) throw AgentErrors.state(`No state for stage "${toStage}". Run apply first.`, `Run \`wd apply --stage ${toStage}\` first.`);
          const content = readFileSync(resolve(rootDir, envFile), "utf-8");
          const envVars = new Map<string, string>();
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIndex = trimmed.indexOf("=");
            if (eqIndex === -1) continue;
            envVars.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
          }

          const { set, skipped } = buildSecretSyncPreview(config.secrets, state, envVars);

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
        assertStage(stage);
        const config = await loadConfig(rootDir);
        const wrangler = createWranglerRunner();
        const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));

        const statuses = await checkSecrets(
          { stage },
          { rootDir, config, state: stateProvider, wrangler },
        );
        const missing = statuses.filter((s) => s.status === "missing");

        if (missing.length === 0) {
          if (wantsJsonOutput()) {
            printJson({ stage, status: "all-set" });
          } else {
            console.log(`\n  All secrets are set for stage "${stage}".\n`);
          }
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

        // Non-interactive mode (--yes): accept --value key=value pairs
        const valuePairs = getFlags("value");
        if (hasFlag("yes") || valuePairs.length > 0 || !process.stdin.isTTY) {
          const values = Object.fromEntries(valuePairs.map((pair) => {
            const eq = pair.indexOf("=");
            if (eq === -1) throw AgentErrors.validation(`--value must be key=value, got "${pair}"`, "Pass --value key=value pairs.", { flag: "--value" });
            return [pair.slice(0, eq), pair.slice(eq + 1)];
          }));
          for (const s of missing) {
            const wName = stageState?.workers[s.worker]?.name;
            if (!wName) {
              if (!wantsJsonOutput()) console.log(`  Skipping ${s.worker}/${s.name} (worker not deployed)`);
              continue;
            }
            const value = values[`${s.worker}/${s.name}`] ?? values[s.name];
            if (value) {
              setSecret({ workerName: wName, secretName: s.name, value }, { rootDir, wrangler });
              if (!wantsJsonOutput()) console.log(`  + ${s.worker}/${s.name}`);
            }
          }
          if (wantsJsonOutput()) {
            printJson({ stage, set: missing.map((s) => `${s.worker}/${s.name}`) });
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
      assertStage(stage);
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
        const icon = s.status === "set" ? "+" : s.status === "ref" ? "→" : "x";
        const note = s.status === "ref" ? "ref (external)" : s.status;
        console.log(`    ${icon} ${s.name}: ${note}`);
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
      assertStage(stage);
      const canaryPercentRaw = getFlag("canary");
      const canaryParsed = canaryPercentRaw ? Number.parseInt(canaryPercentRaw, 10) : Number.NaN;
      const canaryPercent = Number.isNaN(canaryParsed) ? undefined : canaryParsed;
      if (canaryPercentRaw && (!Number.isInteger(canaryParsed) || canaryParsed < 1 || canaryParsed > 99)) {
        throw AgentErrors.validation("--canary must be an integer between 1 and 99.", "Pass --canary <integer between 1 and 99>.", { flag: "--canary" });
      }
      if (hasFlag("lock")) {
        const existing = readDeployLock(rootDir, stage);
        if (existing) {
          throw AgentErrors.state(`Stage "${stage}" is locked by ${existing.owner} since ${existing.createdAt}.`, `Release the lock with \`wd lock release --stage ${stage}\`.`);
        }
        const lock = writeDeployLock(rootDir, stage);
        if (!wantsJsonOutput()) console.log(`  acquired lock for ${stage} (${lock.owner})`);
      }
      const baseConfig = await loadConfig(rootDir);
      const inputSelection = readSelectionFromInput();
      const workersOnly = [...getFlags("only"), ...inputSelection.workersOnly];
      const changedOnly = hasFlag("changed");
      const changedWorkers = changedOnly ? detectChangedWorkers(rootDir, baseConfig.workers) : [];
      const selectedWorkers = workersOnly.length > 0 ? workersOnly : changedWorkers;
      const config = selectedWorkers.length > 0 ? selectConfigWorkers(baseConfig, selectedWorkers) : baseConfig;
      const wrangler = createWranglerRunner();
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const preDeployState = await stateProvider.read(stage);
      const logger = wantsJsonOutput() ? silentLogger : console;

      if (isDryRun(args)) {
        const state = await stateProvider.read(stage);
        assertStageState(state, stage);

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
          maybeWriteArtifact(result);
        } else {
          maybeWriteArtifact(result);
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

      const runDeploy = () =>
        deploy(
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

      if (hasFlag("plan-only")) {
        const state = await stateProvider.read(stage);
        assertStageState(state, stage);
        const actions = resolveDeployOrder(config).map((workerPath) => ({
          workerPath,
          workerName: state.workers[workerPath]?.name ?? workerPath,
          targetVersion: state.workers[workerPath]?.versionId ?? null,
        }));
        if (wantsJsonOutput()) {
          printJson({ stage, planOnly: true, actions });
        } else {
          console.log(`\n  deploy plan (${stage})\n`);
          for (const action of actions) {
            console.log(`  - ${action.workerName} (${action.workerPath})${action.targetVersion ? ` -> ${action.targetVersion}` : ""}`);
          }
          console.log("");
        }
        break;
      }

      const result = await runDeploy();
      const canaryApplied: Array<{ workerPath: string; workerName: string; canaryPercent: number; stablePercent: number }> = [];
      if (canaryPercent) {
        const pct = canaryPercent;
        for (const deployed of result.deployedWorkers) {
          const previousVersion = preDeployState?.workers[deployed.workerPath]?.versionId;
          const newVersion = deployed.versionId;
          if (!previousVersion || !newVersion || previousVersion === newVersion) continue;
          const stablePercent = 100 - pct;
          const specs = [`${newVersion}@${pct}%`, `${previousVersion}@${stablePercent}%`];
          try {
            wrangler.run(["versions", "deploy", ...specs, "--name", deployed.name, "-y"], rootDir);
            canaryApplied.push({
              workerPath: deployed.workerPath,
              workerName: deployed.name,
              canaryPercent: pct,
              stablePercent,
            });
          } catch (error) {
            try {
              wrangler.run(["versions", "deploy", `${newVersion}@100%`, "--name", deployed.name, "-y"], rootDir);
            } catch {
              // best-effort rollback to full new version
            }
            throw new Error(`Canary rollout failed for ${deployed.name}: ${(error as Error).message}`);
          }
        }
        if (!wantsJsonOutput()) {
          if (canaryApplied.length > 0) {
            console.log(`\n  canary rollout applied (${pct}% new / ${100 - pct}% previous)\n`);
            for (const item of canaryApplied) console.log(`  - ${item.workerName} (${item.workerPath})`);
            console.log("");
          } else {
            console.log("\n  canary skipped: missing version IDs or no previous version to split traffic.\n");
          }
        }
      }
      const deploySummary = { ...result, canary: canaryPercent ?? null, canaryApplied, lock: hasFlag("lock") };
      if (wantsJsonOutput()) {
        printJson(deploySummary);
        maybeWriteArtifact(deploySummary);
      } else {
        maybeWriteArtifact(deploySummary);
        printNextActions([
          `wd status --stage ${stage}`,
          `wd open --stage ${stage}${result.deployedWorkers[0] ? ` --worker ${result.deployedWorkers[0].workerPath}` : ""}`,
          `wd dashboard --stage ${stage}${result.deployedWorkers[0] ? ` --worker ${result.deployedWorkers[0].workerPath}` : ""}`,
        ]);
      }

      const selected = result.deployedWorkers[0];
      if (selected && (hasFlag("open") || hasFlag("dashboard"))) {
        const accountId = (await import("../core/auth.js")).resolveAccountId(rootDir);
        if (hasFlag("open") && selected.urls[0]) {
          if (hasFlag("print-url")) {
            console.log(selected.urls[0]);
          } else if (!hasFlag("no-open")) {
            openUrl(selected.urls[0]);
          }
        }
        if (hasFlag("dashboard")) {
          const url = `https://dash.cloudflare.com/${accountId}/workers/services/view/${selected.name}`;
          if (hasFlag("print-url")) {
            console.log(url);
          } else if (!hasFlag("no-open")) {
            openUrl(url);
          }
        }
      }
      maybeRecordTelemetry(rootDir, !!projectContext.telemetry, "deploy", commandStartedAt);
      if (hasFlag("lock")) clearDeployLock(rootDir, stage);

      if (hasFlag("watch")) {
        const targets = resolveWatchTargets(rootDir, config.workers ?? []);
        console.log(`\n  watching ${targets.length} files for changes (Ctrl+C to stop)\n`);
        const watcher = startWatch({
          paths: targets,
          onChange: async () => {
            try {
              console.log(`\n  config change detected — re-deploying...\n`);
              await runDeploy();
            } catch (error) {
              console.error(`\n  deploy failed: ${(error as Error).message}\n`);
            }
          },
        });
        const shutdown = () => { watcher.close(); process.exit(0); };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        await new Promise(() => {});
      }
      break;
    }

    case "destroy": {
      assertStage(stage);
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

      if (hasFlag("interactive")) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
        try {
          const proceed = (await question(`Destroy stage "${stage}" now? [y/N]: `)).trim().toLowerCase();
          if (!["y", "yes"].includes(proceed)) {
            console.log("  cancelled");
            break;
          }
        } finally {
          rl.close();
        }
      }

      const result = await destroy(
        { stage, force: hasFlag("force") },
        { rootDir, config, state: stateProvider, wrangler, logger },
      );
      if (wantsJsonOutput()) {
        printJson(result);
      } else {
        printNextActions(["wd status", "wd apply --stage <name>"]);
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
          maybeWriteArtifact(result);
          if (!result.passed) process.exit(1);
          break;
        }
        maybeWriteArtifact(result);

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

      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const probeUrls = hasFlag("probe-urls");
      const probeTimeoutRaw = getFlag("probe-timeout-ms");
      const probeTimeoutMs = probeTimeoutRaw ? Number(probeTimeoutRaw) : undefined;
      const result = await verify(
        { stage, probeUrls, ...(probeTimeoutMs !== undefined ? { probeTimeoutMs } : {}) },
        { rootDir, config, state: stateProvider },
      );

      if (wantsJsonOutput()) {
        printJson(result);
        maybeWriteArtifact(result);
        if (!result.passed) process.exit(1);
        break;
      }
      maybeWriteArtifact(result);

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
        if (isDryRun(args)) {
          const preview = { ok: true, dryRun: true, name, sources: ["state", "secrets", "rendered"] };
          if (wantsJsonOutput()) printJson(preview);
          else console.log(`\n  [dry-run] snapshot ${name} would be saved\n`);
          break;
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
        if (isDryRun(args)) {
          const preview = { ok: true, dryRun: true, name, note: "would restore state from snapshot" };
          if (wantsJsonOutput()) printJson(preview);
          else console.log(`\n  [dry-run] snapshot ${name} would be loaded\n`);
          break;
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
      const watchEnabled = hasFlag("watch");
      const watchIntervalMs = Math.max(1000, Number.parseInt(getFlag("interval-ms") ?? "5000", 10));
      const outputMode = parseStatusOutputMode();

      if (hasFlag("web")) {
        const { startDeployedUi } = await import("../core/deployed-ui.js");
        const port = getFlag("port") ? Number.parseInt(getFlag("port")!, 10) : 8899;
        const ui = await startDeployedUi(config, rootDir, stateProvider, stage, port);
        console.log(`\n  status web -> http://127.0.0.1:${ui.port}\n`);
        const shutdown = async () => {
          console.log("\n  Stopping status web...");
          await ui.stop();
          process.exit(0);
        };
        process.on("SIGINT", () => { void shutdown(); });
        process.on("SIGTERM", () => { void shutdown(); });
        await new Promise(() => {});
        break;
      }

      if (stage) {
        let previousState: Awaited<ReturnType<typeof stateProvider.read>> | undefined;
        const renderStageStatus = async (tick?: number) => {
          const stageState = await stateProvider.read(stage);
          if (outputMode === "json") {
            let diff: { workersChanged: number; resourcesChanged: number } | undefined;
            if (hasFlag("diff") && previousState && stageState) {
              const workersChanged = Object.keys(stageState.workers).filter((k) => JSON.stringify(stageState.workers[k]) !== JSON.stringify(previousState?.workers[k])).length;
              const resourcesChanged = Object.keys(stageState.resources).filter((k) => JSON.stringify(stageState.resources[k]) !== JSON.stringify(previousState?.resources[k])).length;
              diff = { workersChanged, resourcesChanged };
            }
            const payload = { stage, tick: tick ?? 1, state: stageState, ...(diff ? { diff } : {}) };
            printJson(payload);
            // Only persist the first tick to avoid noisy artifact churn during --watch.
            if ((tick ?? 1) === 1) maybeWriteArtifact(payload);
            previousState = stageState;
            return;
          }
          if (outputMode === "ndjson") {
            process.stdout.write(`${JSON.stringify({ stage, tick: tick ?? 1, state: stageState })}\n`);
            previousState = stageState;
            return;
          }
          if (!stageState) {
            console.log(`  No state found for stage "${stage}".`);
            return;
          }
          if (hasFlag("summary")) {
            const workers = Object.keys(stageState.workers).length;
            const resources = Object.keys(stageState.resources).length;
            const deployed = Object.values(stageState.workers).filter((w) => w.deployed).length;
            console.log(`${stage} workers=${workers} deployed=${deployed} resources=${resources} updated=${stageState.updatedAt}`);
            previousState = stageState;
            return;
          }
          if (watchEnabled && !isQuiet()) {
            process.stdout.write("\u001Bc");
            console.log(`  status watch: ${stage} (tick ${tick ?? 1}, interval ${watchIntervalMs}ms)\n`);
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
          if (hasFlag("diff") && previousState) {
            const workersChanged = Object.keys(stageState.workers).filter((k) => JSON.stringify(stageState.workers[k]) !== JSON.stringify(previousState?.workers[k])).length;
            const resourcesChanged = Object.keys(stageState.resources).filter((k) => JSON.stringify(stageState.resources[k]) !== JSON.stringify(previousState?.resources[k])).length;
            console.log(`\n  Diff since last tick: ${workersChanged} worker changes, ${resourcesChanged} resource changes`);
          }
          console.log("");
          previousState = stageState;
        };
        if (watchEnabled) {
          let tick = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            tick += 1;
            await renderStageStatus(tick);
            await new Promise((resolve) => setTimeout(resolve, watchIntervalMs));
          }
        } else {
          await renderStageStatus();
        }
        if (hasFlag("fail-on-drift")) {
          const latest = await stateProvider.read(stage);
          const drift = Object.values(latest?.resources ?? {}).some((r) => r.lifecycleStatus === "drifted" || r.lifecycleStatus === "orphaned");
          if (drift) process.exit(1);
        }
        maybeRecordTelemetry(rootDir, !!projectContext.telemetry, "status", commandStartedAt);
      } else {
        const stages = await stateProvider.list();
        if (outputMode === "json") {
          const details: Array<{ stage: string; state: NonNullable<Awaited<ReturnType<typeof stateProvider.read>>> }> = [];
          for (const name of stages) {
            const state = await stateProvider.read(name);
            if (state) details.push({ stage: name, state });
          }
          const payload = { stages: details };
          printJson(payload);
          maybeWriteArtifact(payload);
          return;
        }
        if (outputMode === "ndjson") {
          for (const name of stages) {
            const state = await stateProvider.read(name);
            process.stdout.write(`${JSON.stringify({ stage: name, state })}\n`);
          }
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

    case "output": {
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      assertStageState(stageState, stage);

      if (wantsJsonOutput()) {
        printJson({ stage, resources: stageState.resources, workers: stageState.workers });
        break;
      }

      const { resourceId } = await import("../types.js");
      const accountId = await (async () => {
        const { resolveAccountId } = await import("../core/auth.js");
        return resolveAccountId(rootDir);
      })();

      console.log(`\n  ─── ${stage} outputs ───\n`);

      const resourceEntries = Object.entries(stageState.resources);
      if (resourceEntries.length > 0) {
        console.log(`  Resources (${resourceEntries.length}):`);
        for (const [, r] of resourceEntries) {
          const id = resourceId(r);
          const lifecycle = r.lifecycleStatus === "created" || r.lifecycleStatus === "updated" ? "active" : r.lifecycleStatus;
          console.log(`    ${r.props.name}  ${r.type}  ${lifecycle}${id ? `  id: ${id}` : ""}`);
        }
        console.log("");
      }

      const workerEntries = Object.entries(stageState.workers);
      if (workerEntries.length > 0) {
        console.log(`  Workers (${workerEntries.length}):`);
        for (const [, w] of workerEntries) {
          const ws = w as { name: string; url?: string; versionId?: string };
          const status = (ws as Record<string, unknown>).deployed ? "deployed" : "pending";
          console.log(`    ${ws.name}  ${status}${ws.url ? `  ${ws.url}` : ""}`);
          if ((ws as Record<string, unknown>).versionId) {
            console.log(`      version: ${(ws as Record<string, unknown>).versionId}`);
          }
          const dashUrl = `https://dash.cloudflare.com/${accountId}/workers/services/view/${ws.name}`;
          console.log(`      dashboard: ${dashUrl}`);
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

    case "guard": {
      const sub = args[1];
      if (sub !== "status" && sub !== "breaches" && sub !== "report" && sub !== "disarm" && sub !== "arm" && sub !== "init" && sub !== "deploy" && sub !== "migrate" && sub !== "approvals" && sub !== "approve" && sub !== "reject") {
        console.error("Usage: wd guard <status|breaches|report|disarm|arm|init|deploy|migrate|approvals|approve|reject> [--json] [--account <id>] [--limit <n>] [--date <YYYY-MM-DD>] [--reason <text>] [--dir <path>] [--billing-cycle-day <1-31>] [--dry-run] [--skip-d1] [--force]");
        process.exit(2);
      }

      const cliDir = fileURLToPath(new URL(".", import.meta.url));
      const guardDir = resolve(cliDir, "..", "..", "guard");

      const cfg = await loadConfig(rootDir);
      const token = process.env.CLOUDFLARE_API_TOKEN;
      const json = hasFlag("json");

      if (sub === "init") {
        const accountId = getFlag("account");
        const billingCycleDay = Number(getFlag("billing-cycle-day") ?? "1");
        const workersFlag = getFlag("workers");
        const yes = hasFlag("yes");

        if (!accountId) {
          console.error("--account <id> is required for `wd guard init`.");
          process.exit(2);
        }
        if (!Number.isInteger(billingCycleDay) || billingCycleDay < 1 || billingCycleDay > 31) {
          console.error("--billing-cycle-day must be an integer between 1 and 31.");
          process.exit(2);
        }

        // Parse --workers flag or prompt
        let workerNames: string[] = workersFlag
          ? workersFlag.split(",").map((s) => s.trim()).filter(Boolean)
          : [];

        const notifications: NotificationChannelConfig[] = [];

        if (!yes && process.stdin.isTTY && process.stdout.isTTY) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

          if (workerNames.length === 0) {
            const raw = await question("  Worker script names to monitor (comma-separated, or empty to skip): ");
            workerNames = raw.split(",").map((s) => s.trim()).filter(Boolean);
          }

          console.log(`\n  Configure notification channels (leave empty to skip):\n`);
          let index = 1;
          while (true) {
            const type = await question(`  Channel ${index} type (discord/slack/webhook, or empty to finish): `);
            if (!type || !["discord", "slack", "webhook"].includes(type)) break;
            const name = await question(`  Channel ${index} name (unique): `);
            if (!name) { console.log("  Name is required."); continue; }
            const secretName = await question(`  Channel ${index} secret name (e.g. DISCORD_WEBHOOK): `);
            if (!secretName) { console.log("  Secret name is required."); continue; }
            const channelType = type as "discord" | "slack" | "webhook";
            if (channelType === "webhook") {
              notifications.push({ type: "webhook", name, urlSecret: secretName });
            } else {
              notifications.push({ type: channelType, name, webhookUrlSecret: secretName });
            }
            index += 1;
          }
          rl.close();
        }

        const workers = workerNames.map((scriptName) => ({ scriptName }));
        const accountsJson = JSON.stringify([{
          accountId,
          billingCycleDay,
          workers,
          globalProtected: [],
        }]);
        const notificationsJson = JSON.stringify({ channels: notifications });
        const signingKey = generateSigningKey();

        // Step 1: Create D1 database (or use existing)
        const existingDatabaseId = getFlag("database-id") ?? cfg?.guard?.databaseId;
        let databaseId: string;
        if (existingDatabaseId) {
          databaseId = existingDatabaseId;
          console.log(`\n  Using existing D1 database: ${databaseId}`);
        } else {
          console.log(`\n  Creating D1 database "workers-usage-guard"...`);
          try {
            ({ databaseId } = createD1Database(
              { name: "workers-usage-guard", targetDir: guardDir },
              { execFileSync }
            ));
            console.log(`  ✔ D1 database created: ${databaseId}`);
          } catch (e) {
            console.error(`  D1 creation failed: ${(e as Error).message}`);
            console.error(`  If the database already exists, pass --database-id <id> to skip creation.`);
            process.exit(1);
          }
        }

        // Step 2: Apply migrations
        console.log(`  Applying D1 migrations...`);
        try {
          const { output } = runMigrations({ guardDir, databaseId }, { execFileSync });
          if (output.trim()) console.log(output.trim());
          console.log(`  ✔ Migrations applied`);
        } catch (e) {
          console.error(`  Migrations failed: ${(e as Error).message}`);
          process.exit(1);
        }

        // Step 3: Set secrets
        console.log(`  Setting secrets on workers-usage-guard...`);
        const cfToken = process.env.CLOUDFLARE_API_TOKEN;
        if (!cfToken) {
          console.warn("  ⚠ CLOUDFLARE_API_TOKEN is not set — set it manually after deploy:\n    wrangler secret put CLOUDFLARE_API_TOKEN --name workers-usage-guard");
        }
        const secretsToSet: Array<{ name: string; value: string }> = [
          ...(cfToken ? [{ name: "CLOUDFLARE_API_TOKEN", value: cfToken }] : []),
          { name: "GUARD_API_SIGNING_KEY", value: signingKey },
          { name: "ACCOUNTS_JSON", value: accountsJson },
          { name: "NOTIFICATIONS_JSON", value: notificationsJson },
        ];
        const notificationSecrets = notifications.map((n) =>
          n.type === "webhook" ? n.urlSecret : n.webhookUrlSecret
        );
        for (const secret of secretsToSet) {
          try {
            execFileSync("wrangler", ["secret", "put", secret.name, "--name", "workers-usage-guard"], {
              input: secret.value,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
            });
            console.log(`  ✔ Secret set: ${secret.name}`);
          } catch (e) {
            console.error(`  Failed to set ${secret.name}: ${(e as Error).message}`);
            process.exit(1);
          }
        }

        // Step 4: Deploy
        console.log(`  Deploying workers-usage-guard...`);
        let workerUrl: string | undefined;
        try {
          ({ workerUrl } = deployGuard({ guardDir, databaseId }, { execFileSync }));
          console.log(`  ✔ Deployed${workerUrl ? ` → ${workerUrl}` : ""}`);
        } catch (e) {
          console.error(`  Deploy failed: ${(e as Error).message}`);
          process.exit(1);
        }

        // Step 5: Print config snippet
        console.log(`\n  Add this to your wrangler-deploy.config.ts:\n`);
        console.log(`    guard: {`);
        if (workerUrl) console.log(`      endpoint: "${workerUrl}",`);
        console.log(`      databaseId: "${databaseId}",`);
        console.log(`    },`);
        if (notificationSecrets.length > 0) {
          console.log(`\n  Set these notification secrets when ready:`);
          for (const s of notificationSecrets) console.log(`    wrangler secret put ${s} --name workers-usage-guard`);
        }
        console.log("");
        return;
      }

      if (sub === "deploy") {
        const databaseId = cfg?.guard?.databaseId ?? getFlag("database-id");
        if (!databaseId) {
          console.error("guard.databaseId is required in wrangler-deploy.config.ts or pass --database-id <id>.");
          process.exit(2);
        }
        console.log("  Deploying workers-usage-guard...");
        try {
          const { workerUrl } = deployGuard({ guardDir, databaseId }, { execFileSync });
          console.log(`  ✔ Deployed${workerUrl ? ` → ${workerUrl}` : ""}`);
        } catch (e) {
          console.error(`  Deploy failed: ${(e as Error).message}`);
          process.exit(1);
        }
        return;
      }

      if (sub === "migrate") {
        const databaseId = cfg?.guard?.databaseId ?? getFlag("database-id");
        if (!databaseId) {
          console.error("guard.databaseId is required in wrangler-deploy.config.ts or pass --database-id <id>.");
          process.exit(2);
        }
        console.log("  Applying D1 migrations...");
        try {
          const { output } = runMigrations({ guardDir, databaseId }, { execFileSync });
          console.log(output.trim());
          console.log("  ✔ Migrations applied");
        } catch (e) {
          console.error(`  Migration failed: ${(e as Error).message}`);
          process.exit(1);
        }
        return;
      }

      const endpoint = cfg?.guard?.endpoint;
      const signingKey = process.env.WRANGLER_DEPLOY_GUARD_SIGNING_KEY;
      const client = endpoint && signingKey ? createGuardClient({ endpoint, signingKey }) : undefined;

      if (sub === "status") {
        const accounts = cfg?.guard?.accounts ?? [];
        if (accounts.length === 0) {
          console.error(
            "No accounts configured. Set `guard.accounts` in wrangler-deploy.config.ts — see docs."
          );
          process.exit(2);
        }
        if (!token) {
          console.error("CLOUDFLARE_API_TOKEN env var is required for `wd guard status`.");
          process.exit(2);
        }
        const statusDeps: Parameters<typeof runStatus>[1] = {
          now: () => new Date(),
          fetchUsage: (a) => fetchWorkerUsage(a, { fetch, token }),
        };
        if (client) statusDeps.breachClient = client;
        const rows = await runStatus({ accounts }, statusDeps);
        console.log(json ? renderStatusJson(rows) : renderStatusTable(rows));
        return;
      }

      // `breaches`, `report`, `disarm`, and `arm` all require a configured endpoint + signing key.
      const accountId = getFlag("account");

      if (sub === "disarm" || sub === "arm") {
        const scriptName = args[2];
        if (!scriptName) {
          console.error(`--account <id> and <script> are required. Usage: wd guard ${sub} <script> --account <id>${sub === "disarm" ? " [--reason <text>]" : ""}`);
          process.exit(2);
        }
        if (!client) {
          console.error(
            "`wd guard " + sub + "` requires guard.endpoint in wrangler-deploy.config.ts AND " +
              "WRANGLER_DEPLOY_GUARD_SIGNING_KEY env var."
          );
          process.exit(2);
        }
        if (!accountId) {
          console.error("--account <id> is required.");
          process.exit(2);
        }
        if (sub === "disarm") {
          const reason = getFlag("reason");
          const addedBy = `cli:${process.env.USER ?? "unknown"}`;
          await runDisarm(
            reason
              ? { accountId, scriptName, addedBy, reason }
              : { accountId, scriptName, addedBy },
            { client }
          );
          console.log(`Disarmed ${scriptName} on account ${accountId}`);
        } else {
          await runArm({ accountId, scriptName }, { client });
          console.log(`Re-armed ${scriptName} on account ${accountId}`);
        }
        return;
      }

      if (!client) {
        console.error(
          "`wd guard " + sub + "` requires guard.endpoint in wrangler-deploy.config.ts AND " +
            "WRANGLER_DEPLOY_GUARD_SIGNING_KEY env var."
        );
        process.exit(2);
      }
      if (!accountId) {
        console.error("--account <id> is required.");
        process.exit(2);
      }

      if (sub === "breaches") {
        const limit = Number(getFlag("limit") ?? "20");
        if (!Number.isFinite(limit) || limit <= 0) {
          console.error("--limit must be a positive number.");
          process.exit(2);
        }
        const rows = await runBreaches({ accountId, limit }, { client });
        console.log(json ? renderBreachesJson(rows) : renderBreachesTable(rows));
        return;
      }

      if (sub === "report") {
        const date = getFlag("date");
        const report = await runReport(
          date ? { accountId, date } : { accountId },
          { client }
        );
        console.log(json ? renderReportJson(report) : renderReportText(report));
        return;
      }

      if (sub === "approvals") {
        const rows = await runListApprovals({ accountId }, { client });
        if (json) {
          printJson(rows);
        } else {
          console.log(`\n  Pending approvals for account ${accountId}\n`);
          if (rows.length === 0) {
            console.log("  (none)\n");
          } else {
            for (const r of rows) {
              console.log(`  ${r.id}`);
              console.log(`    script: ${r.scriptName}`);
              console.log(`    rule: ${r.ruleId} (${r.breachType})`);
              console.log(`    actual: ${r.actualValue} / limit: ${r.limitValue}`);
              console.log(`    created: ${r.createdAt}`);
              console.log(`    expires: ${r.expiresAt}`);
              console.log("");
            }
          }
        }
        return;
      }

      if (sub === "approve" || sub === "reject") {
        const approvalId = args[2];
        if (!approvalId) {
          console.error(`<approval-id> is required. Usage: wd guard ${sub} <approval-id> --account <id>`);
          process.exit(2);
        }
        const decidedBy = `cli:${process.env.USER ?? "unknown"}`;
        try {
          if (sub === "approve") {
            await runApprove({ id: approvalId, accountId, decidedBy }, { client });
            console.log(`Approved ${approvalId}`);
          } else {
            await runReject({ id: approvalId, accountId, decidedBy }, { client });
            console.log(`Rejected ${approvalId}`);
          }
        } catch (e) {
          console.error(`Failed: ${(e as Error).message}`);
          process.exit(1);
        }
        return;
      }

      console.error(`Unknown guard command "${sub}"`);
      process.exit(2);
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

      // Dev doesn't need a stage — only use it if explicitly set by the user
      const devStage = explicitStage ?? projectContext.stage ?? undefined;
      const stateProvider = (devStage || fallbackStage)
        ? resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext))
        : undefined;

      const plan = await buildDevPlan(config, rootDir, {
        basePort,
        filter: filter ?? undefined,
        stage: devStage,
        fallbackStage: fallbackStage ?? undefined,
        stateProvider,
        session,
        persistTo,
      });
      const logDir = resolveDevLogDir(rootDir);

      // NDJSON event-stream mode for agents. One JSON object per line on stdout.
      const eventMode = wantsJsonOutput();
      const emitEvent = (event: Record<string, unknown>): void => {
        if (!eventMode) return;
        process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
      };

      if (eventMode) {
        emitEvent({
          type: "dev.starting",
          mode: plan.mode,
          workers: plan.workers.map((w) => ({ workerPath: w.workerPath })),
          companions: plan.companions.map((c) => ({ name: c.name })),
        });
      }

      const handle = await startDev(plan, {
        logDir,
        rootDir,
        ...(eventMode
          ? {
              // Redirect human-formatted log output to stderr so the NDJSON stream on stdout stays clean.
              output: (line: string) => process.stderr.write(`${line}\n`),
              onLine: (workerPath: string, line: string) => {
                // Strip ANSI before classification.
                const cleaned = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
                if (!cleaned) return;
                const lower = cleaned.toLowerCase();
                const looksLikeError = lower.includes("error") || lower.includes("✗") || lower.startsWith("✘");
                emitEvent({
                  type: looksLikeError ? "worker.error" : "worker.log",
                  workerPath,
                  message: cleaned,
                });
              },
            }
          : {}),
      });

      if (eventMode) {
        for (const worker of plan.workers) {
          const port = handle.ports[worker.workerPath];
          emitEvent({
            type: "worker.ready",
            workerPath: worker.workerPath,
            port,
            url: port ? `http://127.0.0.1:${port}` : null,
          });
        }
      }

      const tunnelHandles: Array<{ worker: string; close: () => Promise<void> }> = [];
      if (hasFlag("tunnel")) {
        const tunnelFilter = getFlag("tunnel");
        const targetWorkers = plan.workers.filter((worker) =>
          !tunnelFilter || tunnelFilter === "all" || tunnelFilter === worker.workerPath,
        );
        if (targetWorkers.length === 0 && tunnelFilter) {
          console.error(`\n  ✗ --tunnel value "${tunnelFilter}" did not match any worker.\n`);
        }
        for (const worker of targetWorkers) {
          const port = handle.ports[worker.workerPath];
          if (!port) continue;
          try {
            const tunnel = startTunnel({ localUrl: `http://localhost:${port}` });
            tunnelHandles.push({ worker: worker.workerPath, close: tunnel.close });
            const url = await tunnel.url;
            console.log(`  tunnel: ${worker.workerPath} -> ${url}`);
          } catch (error) {
            console.error(`  ✗ tunnel for ${worker.workerPath} failed: ${(error as Error).message}`);
          }
        }
      }
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
      // Print persistent dev summary (text mode only).
      if (!eventMode) {
        const modeLabel = plan.mode === "session" ? "session" : "workers";
        console.log(`\n  ─── dev ${modeLabel} ───`);
        for (const worker of plan.workers) {
          const port = handle.ports[worker.workerPath];
          if (port) console.log(`  ${worker.workerPath}  http://127.0.0.1:${port}`);
        }
        console.log(`\n  ${plan.workers.length} worker(s) running. Press Ctrl+C to stop.\n`);
      } else {
        emitEvent({
          type: "dev.ready",
          workerCount: plan.workers.length,
          ports: handle.ports,
          mode: plan.mode,
          logDir,
        });
      }

      const shutdown = async () => {
        if (eventMode) {
          emitEvent({ type: "dev.stopping" });
        } else {
          console.log("\n  Stopping all workers...");
        }
        await Promise.all(tunnelHandles.map((t) => t.close().catch(() => {})));
        await handle.stop();
        clearActiveDevState(rootDir);
        if (eventMode) emitEvent({ type: "dev.stopped" });
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
          throw AgentErrors.network(`Local cron trigger failed with status ${result.status}`, "Check that the dev server is running and the cron expression is valid.");
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
      const grepJson = getFlag("grep-json");
      const sinceMs = getFlag("since") ? Date.now() - parseInterval(getFlag("since")!) : undefined;
      const tail = getFlag("tail") ? Math.max(0, Number.parseInt(getFlag("tail")!, 10)) : undefined;
      const snapshots = readDevLogSnapshot(config, rootDir, { worker: workerPath, grep });
      const positions = new Map<string, number>();
      const filterBySince = (content: string): string => {
        if (!sinceMs) return content;
        return content
          .split("\n")
          .filter((line) => {
            const match = line.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/);
            if (!match) return true;
            const ts = Date.parse(match[1] ?? "");
            return Number.isNaN(ts) ? true : ts >= sinceMs;
          })
          .join("\n");
      };
      const filterByJsonPath = (content: string): string => {
        if (!grepJson) return content;
        return content
          .split("\n")
          .filter((line) => {
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              return Object.prototype.hasOwnProperty.call(parsed, grepJson);
            } catch {
              return false;
            }
          })
          .join("\n");
      };
      const applyTail = (content: string): string => {
        if (tail === undefined) return content;
        const lines = content.split("\n");
        return lines.slice(Math.max(0, lines.length - tail)).join("\n");
      };

      if (wantsJsonOutput()) {
        printJson({
          worker: workerPath ?? null,
          grep: grep ?? null,
          since: getFlag("since") ?? null,
          once: hasFlag("once"),
          snapshots: snapshots.map((snapshot) => ({
            workerPath: snapshot.workerPath,
            logFile: snapshot.logFile,
            content: applyTail(filterByJsonPath(filterBySince(snapshot.content))),
          })),
        });
        break;
      }

      console.log("\n  Tailing dev logs\n");
      for (const snapshot of snapshots) {
        const content = applyTail(filterByJsonPath(filterBySince(snapshot.content)));
        if (content.trim()) {
          console.log(`  [${snapshot.workerPath}]`);
          process.stdout.write(content);
        }
        positions.set(snapshot.logFile, content.length);
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
        if (!result.ok) throw AgentErrors.network("worker call failed", "Check that the dev server is running and the worker URL is reachable.");
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
      const d1Sub = args[2];
      const logicalName = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
      const config = await loadConfig(rootDir);
      const fixtureName = getFlag("fixture");

      if (subCmd === "migrate" && d1Sub === "status") {
        assertStage(stage);
        const rows = Object.entries(config.resources)
          .filter(([, resource]) => (resource as { type?: string }).type === "d1")
          .map(([name, resource]) => {
            const migrationsDir = (resource as { migrationsDir?: string }).migrationsDir;
            const dirPath = migrationsDir ? resolve(rootDir, migrationsDir) : null;
            const files = dirPath && existsSync(dirPath) ? readdirSync(dirPath).filter((f) => f.endsWith(".sql")).sort() : [];
            return { database: name, migrationsDir: migrationsDir ?? null, files, total: files.length };
          });
        if (wantsJsonOutput()) printJson({ stage, databases: rows });
        else {
          console.log(`\n  d1 migrate status (${stage})\n`);
          for (const row of rows) {
            console.log(`  ${row.database}: ${row.total} migration file(s)${row.migrationsDir ? ` (${row.migrationsDir})` : ""}`);
          }
          console.log("");
        }
        break;
      }

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
      const queueSub = args[2];
      const config = await loadConfig(rootDir);
      const fixtureName = getFlag("fixture");

      if (subCmd === "dlq") {
        const allRoutes = listQueueRoutes(config);
        const dlqs = allRoutes.filter((route) => !!route.deadLetterFor);
        if (queueSub === "list") {
          if (wantsJsonOutput()) printJson({ dlqs });
          else {
            console.log("\n  dead-letter queues\n");
            for (const route of dlqs) console.log(`  ${route.logicalName} <- ${route.deadLetterFor}`);
            if (dlqs.length === 0) console.log("  (none)");
            console.log("");
          }
          break;
        }
        const logicalName = args[3] && !args[3].startsWith("--") ? args[3] : undefined;
        assertUsage(logicalName, "Usage: wd queue dlq <retry|drop> <queue> [--file <jsonl>]");
        const dlq = dlqs.find((route) => route.logicalName === logicalName);
        if (!dlq) throw AgentErrors.notFound(`Queue "${logicalName}" is not a dead-letter queue.`, "Run `wd queue dlq list` to see available DLQs.");
        if (queueSub === "drop") {
          if (wantsJsonOutput()) printJson({ queue: logicalName, dropped: true, mode: "metadata-only" });
          else console.log(`\n  dropped DLQ messages for ${logicalName} (metadata-only helper)\n`);
          break;
        }
        if (queueSub === "retry") {
          const file = getFlag("file");
          if (!file) throw AgentErrors.validation("wd queue dlq retry requires --file <jsonl> exported messages", "Pass --file <jsonl> with exported DLQ messages.", { flag: "--file" });
          const payloads = readFileSync(resolve(rootDir, file), "utf-8").split("\n").filter(Boolean);
          const result = await replayQueueMessages(config, rootDir, {
            queue: dlq.deadLetterFor ?? logicalName,
            payloads,
            worker: getFlag("worker"),
          });
          if (wantsJsonOutput()) printJson(result);
          else console.log(`\n  retried ${result.results.filter((r) => r.ok).length}/${result.results.length} messages to ${dlq.deadLetterFor}\n`);
          if (result.results.some((r) => !r.ok)) process.exit(1);
          break;
        }
        throw AgentErrors.validation("Usage: wd queue dlq list|retry|drop ...");
      }

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
          if (!result.ok) throw AgentErrors.network("queue send failed", "Check that the dev server is running and the queue worker is reachable.");
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
    const path = resolve(dir, "wrangler-deploy.yml");
    const exists = existsSync(path);
    if (isDryRun(args)) {
      const preview = { ok: true, dryRun: true, provider, path, mainBranch, wouldOverwrite: exists, bytes: Buffer.byteLength(yaml, "utf-8"), preview: yaml };
      if (wantsJsonOutput()) printJson(preview);
      else console.log(`  [dry-run] Would write ${path} (${preview.bytes} bytes)`);
      maybeWriteArtifact(preview);
      break;
    }
    if (exists && !hasFlag("force")) {
      const message = `${path} already exists. Pass --force to overwrite.`;
      if (wantsJsonOutput()) printJson({ ok: false, command: "wd ci init", error: { type: "validation", code: "WD_E_VALIDATION", message, retryable: false, fix: "Re-run with --force or remove the file." } });
      else console.error(`  ✗ ${message}`);
      process.exit(1);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, yaml);
    const result = { ok: true, provider, path, mainBranch, bytes: Buffer.byteLength(yaml, "utf-8") };
    if (wantsJsonOutput()) printJson(result);
    else console.log(`  ✓ Generated ${path}`);
    maybeWriteArtifact(result);
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

    case "open": {
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      assertStageState(stageState, stage);

      const target = getFlag("worker") || (args[1] && !args[1].startsWith("--") ? args[1] : undefined);
      const entries = listWorkersWithUrl(stageState);
      if (entries.length === 0) throw AgentErrors.notFound(`No deployed workers with URLs in stage "${stage}".`, `Deploy a worker first with \`wd deploy --stage ${stage}\`.`);
      let selected = target ? matchWorker(stageState, target) : resolveDefaultWorker(stageState, entries);
      if (!selected) throw AgentErrors.notFound(`No worker found matching "${target}" in stage "${stage}".`, "Pass --worker <name> matching a deployed worker.");
      if (!target && !hasFlag("latest") && entries.length > 1) {
        const prompted = await promptWorkerChoice(stage, entries);
        if (prompted) selected = prompted;
      }

      const targetUrl = selected.worker.url;
      if (!targetUrl) throw AgentErrors.state(`Selected worker "${selected.worker.name}" has no URL in state.`, `Re-run \`wd deploy --stage ${stage}\` to refresh the worker URL.`);
      if (wantsJsonOutput()) {
        printJson({
          stage,
          workerPath: selected.workerPath,
          workerName: selected.worker.name,
          url: targetUrl,
          opened: !hasFlag("print-url") && !hasFlag("no-open"),
        });
        break;
      }
      if (hasFlag("print-url")) {
        console.log(targetUrl);
        break;
      }
      if (hasFlag("copy")) {
        copyToClipboard(targetUrl);
        console.log(`\n  Copied ${targetUrl}\n`);
        break;
      }
      if (hasFlag("no-open")) break;
      console.log(`\n  Opening ${targetUrl}...\n`);
      openUrl(targetUrl);
      break;
    }

    case "dashboard": {
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      assertStageState(stageState, stage);

      const { resolveAccountId } = await import("../core/auth.js");
      const accountId = resolveAccountId(rootDir);
      const target = getFlag("worker") || (args[1] && !args[1].startsWith("--") ? args[1] : undefined);
      const entries = Object.entries(stageState.workers).map(([workerPath, worker]) => ({ workerPath, worker }));
      if (entries.length === 0) throw AgentErrors.notFound(`No workers found in stage "${stage}".`, `Run \`wd deploy --stage ${stage}\` first.`);
      let selected = target ? matchWorker(stageState, target) : resolveDefaultWorker(stageState, listWorkersWithUrl(stageState));
      if (!selected) {
        selected = entries[0];
      }
      if (!selected) throw AgentErrors.notFound(`No workers found in stage "${stage}".`, `Run \`wd deploy --stage ${stage}\` first.`);
      if (!target && !hasFlag("latest") && entries.length > 1) {
        const prompted = await promptWorkerChoice(stage, entries);
        if (prompted) selected = prompted;
      }
      const dashUrl = `https://dash.cloudflare.com/${accountId}/workers/services/view/${selected.worker.name}`;

      if (wantsJsonOutput()) {
        printJson({
          stage,
          workerPath: selected.workerPath,
          workerName: selected.worker.name,
          url: dashUrl,
          opened: !hasFlag("print-url") && !hasFlag("no-open"),
        });
        break;
      }
      if (hasFlag("print-url")) {
        console.log(dashUrl);
        break;
      }
      if (hasFlag("copy")) {
        copyToClipboard(dashUrl);
        console.log(`\n  Copied ${dashUrl}\n`);
        break;
      }
      if (hasFlag("no-open")) break;
      console.log(`\n  Opening ${dashUrl}...\n`);
      openUrl(dashUrl);
      break;
    }

    case "doctor": {
      // Doctor must work even before there's a project — that's exactly when
      // beginners need it. Fall back to a minimal config-less doctor run when
      // no wrangler-deploy config is present yet.
      const configPath = resolve(rootDir, "wrangler-deploy.config.ts");
      const configJsPath = resolve(rootDir, "wrangler-deploy.config.js");
      const hasConfig = existsSync(configPath) || existsSync(configJsPath);
      let configForDoctor: import("../types.js").CfStageConfig;
      const configErrors: string[] = [];
      if (hasConfig) {
        try {
          configForDoctor = await loadConfig(rootDir);
          configErrors.push(...validateConfig(configForDoctor));
        } catch (err) {
          configForDoctor = { version: 1, workers: [], resources: {} };
          configErrors.push(`config import failed: ${(err as Error).message}`);
        }
      } else {
        configForDoctor = { version: 1, workers: [], resources: {} };
      }
      const deps = {
        wranglerVersion: () => runWranglerVersion(),
        wranglerAuth: () => runWranglerWhoami(),
        workerExists: (p: string) => existsSync(resolve(rootDir, p, "wrangler.jsonc")) || existsSync(resolve(rootDir, p, "wrangler.json")),
        configErrors,
      };

      const checks = runDoctor(configForDoctor, deps);
      if (!hasConfig) {
        checks.push({
          name: "wrangler-deploy config",
          status: "warn",
          message: "no wrangler-deploy.config.ts found in this directory",
          details: "Run `wd create vite <name>` to scaffold a starter, or `wd init` if you already have wrangler.jsonc files.",
        });
      }
      const coded = checks.map((check) => ({ check, code: codeForDoctorCheck(check) }));
      if (hasFlag("fix")) {
        const fixes: string[] = [];
        const dryFix = hasFlag("fix-dry-run");
        if (!existsSync(resolve(rootDir, "wrangler-deploy.config.ts")) && !existsSync(resolve(rootDir, "wrangler-deploy.config.js"))) {
          if (!dryFix) {
            const generated = generateConfig(rootDir);
            writeFileSync(resolve(rootDir, "wrangler-deploy.config.ts"), generated);
          }
          fixes.push("Generated `wrangler-deploy.config.ts` from discovered wrangler configs.");
        }
        if (process.env.CLOUDFLARE_ACCOUNT_ID && !projectContext.accountId) {
          if (!dryFix) writeProjectContext(rootDir, { accountId: process.env.CLOUDFLARE_ACCOUNT_ID });
          fixes.push("Saved `CLOUDFLARE_ACCOUNT_ID` into `.wdrc` as `accountId`.");
        }
        if (!projectContext.stage) {
          if (!dryFix) writeProjectContext(rootDir, { stage: "dev" });
          fixes.push("Set default stage to `dev` in `.wdrc`.");
        }
        if (wantsJsonOutput()) {
          printJson({ checks, fixes, dryRun: dryFix });
          break;
        }
        console.log("\n  doctor --fix results:\n");
        if (dryFix) console.log("  (dry-run: no files changed)");
        if (fixes.length === 0) console.log("  no automatic fixes applied");
        for (const fix of fixes) console.log(`  + ${fix}`);
        console.log("");
      }
      if (wantsJsonOutput()) {
        printJson(hasFlag("codes")
          ? { checks: coded, strict: hasFlag("strict") }
          : { checks, strict: hasFlag("strict") });
        if (hasFlag("strict") && checks.some((check) => check.status !== "pass")) process.exit(1);
        break;
      }
      console.log("\n  wrangler-deploy doctor\n");
      for (const check of checks) {
        const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
        console.log(`  ${icon} ${check.name}: ${check.message}`);
        if (check.details) console.log(`    ${check.details}`);
        if (hasFlag("codes")) {
          const c = codeForDoctorCheck(check);
          console.log(`    ${c.id}: ${c.fix}`);
        }
      }
      console.log("");
      printNextActions(["wd plan", "wd apply --stage <name>", "wd deploy --stage <name>"]);
      if (hasFlag("strict") && checks.some((check) => check.status !== "pass")) {
        process.exit(1);
      }
      maybeRecordTelemetry(rootDir, !!projectContext.telemetry, "doctor", commandStartedAt);
      break;
    }

    case "explain": {
      let query = args.slice(1).filter((arg) => !arg.startsWith("--")).join(" ").trim();
      const errorCode = getFlag("error-code");
      if (errorCode) query = errorCode;
      if (hasFlag("from-last-error")) {
        const path = lastErrorPath(rootDir);
        if (!existsSync(path)) {
          throw new UsageError("No previous error recorded. Run a command that fails first, then re-run `wd explain --from-last-error`.");
        }
        const last = JSON.parse(readFileSync(path, "utf-8")) as { message?: string; code?: string };
        query = last.code ?? last.message ?? query;
      }
      const result = explainIssue(query);
      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }
      if (!query) {
        console.log(`\n  wd explain — guided remediation for wrangler-deploy errors\n`);
        console.log(`  ${result.summary}\n`);
        for (const action of result.actions) console.log(`  - ${action}`);
        console.log("");
        break;
      }
      console.log(`\n  explain: ${result.query}\n`);
      console.log(`  ${result.summary}\n`);
      for (const action of result.actions) console.log(`  - ${action}`);
      console.log("");
      break;
    }

    case "sandbox": {
      const sub = args[1];
      const caps = detectSandboxCapabilities();
      if (sub === "info" || !sub) {
        if (wantsJsonOutput()) {
          printJson(caps);
        } else {
          console.log(`\n  wd sandbox\n`);
          console.log(`  platform: ${caps.platform}`);
          console.log(`  kind: ${caps.kind}`);
          console.log(`  available: ${caps.available}`);
          if (caps.binary) console.log(`  binary: ${caps.binary}`);
          console.log(`  writableRoots: ${caps.writableRoots.join(", ")}`);
          for (const note of caps.notes) console.log(`  note: ${note}`);
          console.log(`\n  Run a command sandboxed:\n    wd sandbox run -- wd apply --stage staging\n`);
        }
        break;
      }
      if (sub === "run") {
        const sepIndex = args.indexOf("--", 2);
        const inner = sepIndex === -1 ? args.slice(2) : args.slice(sepIndex + 1);
        if (inner.length === 0) {
          throw AgentErrors.validation("Usage: wd sandbox run -- <command> [args...]", "Pass the command after `--`. Example: wd sandbox run -- wd apply --stage staging");
        }
        if (!caps.available) {
          throwAgentError({
            type: "sandbox",
            code: "WD_E_SANDBOX_BLOCKED",
            message: `Real sandbox not available on ${caps.platform} (kind: ${caps.kind}).`,
            retryable: false,
            fix: caps.platform === "darwin"
              ? "sandbox-exec ships with macOS but isn't on PATH. Use AGENT_SANDBOX=1 for refusal mode instead."
              : caps.platform === "linux"
                ? "Install bubblewrap (`apt install bubblewrap` / `dnf install bubblewrap`) for true isolation. Otherwise use AGENT_SANDBOX=1 refusal mode."
                : "Real OS-level sandbox is not supported on this platform. Use AGENT_SANDBOX=1 refusal mode.",
            expected: { kinds: ["sandbox-exec", "bwrap"], platform: caps.platform },
          });
        }
        const allowHostFlags = getFlags("allow-host");
        const noNetworkFilter = hasFlag("no-network-filter") || allowHostFlags.includes("*");
        const strictNetwork = hasFlag("strict-network");
        const customAllowedHosts = allowHostFlags.filter((h) => h !== "*");
        const proxyDecisions: Array<Record<string, unknown>> = [];
        const result = await runInSandbox(inner, caps, {
          ...(customAllowedHosts.length > 0 ? { allowedHosts: customAllowedHosts } : {}),
          noNetworkFilter,
          strictNetwork,
          ...(wantsJsonOutput()
            ? {
                onProxyDecision: (decision) => {
                  proxyDecisions.push(decision as unknown as Record<string, unknown>);
                },
              }
            : {}),
        });
        if (wantsJsonOutput()) {
          printJson({
            ok: result.status === 0,
            used: result.used,
            status: result.status,
            signal: result.signal,
            command: result.command,
            ...(result.proxy ? { proxy: result.proxy, proxyDecisions } : {}),
            notes: result.notes,
          });
        }
        process.exit(result.status ?? 1);
      }
      throw AgentErrors.validation(`Unknown sandbox subcommand "${sub}". Available: info, run.`);
      break;
    }

    case "examples": {
      const target = getFlag("command") ?? args[1];
      if (!target) {
        const all = allExampleSets();
        if (wantsJsonOutput()) {
          printJson({ commands: listExampleCommands(), sets: all });
          break;
        }
        console.log("\n  wrangler-deploy examples\n");
        for (const set of all) {
          console.log(`  ${set.command} — ${set.summary}`);
        }
        console.log("\n  Use `wd examples --command <name>` for snippets.\n");
        break;
      }

      const set = getExamples(target);
      if (!set) {
        const known = listExampleCommands();
        const error = new Error(
          `No examples found for command "${target}". Known: ${known.join(", ")}.`,
        );
        Object.assign(error, {
          agentError: {
            type: "validation" as const,
            code: "WD_E_VALIDATION",
            message: error.message,
            retryable: false,
            fix: "Pass --command <name> with one of the known commands.",
            expected: { command: known },
          },
        });
        throw error;
      }

      if (wantsJsonOutput()) {
        printJson(set);
        break;
      }
      console.log(`\n  wd ${set.command} — ${set.summary}\n`);
      for (const example of set.examples) {
        console.log(`  ${example.description}`);
        console.log(`    $ ${example.command}`);
        if (example.notes) console.log(`    note: ${example.notes}`);
        console.log("");
      }
      break;
    }

    case "completions": {
      const shell = getFlag("shell");
      if (!shell || !["zsh", "bash", "fish"].includes(shell)) {
        throw new UsageError("wd completions requires --shell zsh|bash|fish");
      }
      console.log(generateCompletions(shell as "zsh" | "bash" | "fish"));
      break;
    }

    case "schema": {
      if (args[1] === "outputs") {
        const commandSchema = getFlag("command");
        if (commandSchema) {
          const schema = schemaForCommand(commandSchema);
          if (!schema) throw AgentErrors.notFound(`No output schema found for command "${commandSchema}"`, "Run `wd schema outputs` to list available command schemas.");
          printJson({ version: 1, command: commandSchema, schema });
          break;
        }
        printJson({ version: 1, schemas: outputSchemas });
        break;
      }
      if (args[1] === "config") {
        printJson({ version: 1, schema: configSchema });
        break;
      }
      if (args[1] === "errors") {
        printJson({ version: 1, schema: outputSchemas.error, codes: cliManifest.errorEnvelope.errorCodes, types: cliManifest.errorEnvelope.errorTypes });
        break;
      }
      if (hasFlag("versioned")) {
        printJson({ schemaVersion: "1.0.0", generatedAt: new Date().toISOString(), manifest: cliManifest, outputs: outputSchemas, config: configSchema });
        break;
      }
      printJson(cliManifest);
      break;
    }

    case "context": {
      const subCommand = args[1];

      if (subCommand === "export") {
        const payload = {
          exportedAt: new Date().toISOString(),
          context: projectContext,
        };
        if (wantsJsonOutput()) {
          printJson(payload);
        } else {
          console.log(`\n${JSON.stringify(payload, null, 2)}\n`);
        }
        break;
      }

      if (subCommand === "import") {
        const from = getFlag("file");
        if (!from) throw AgentErrors.validation("context import requires --file <path>", "Pass --file <path> pointing to a context export.", { flag: "--file" });
        const absolute = resolve(rootDir, from);
        if (!existsSync(absolute)) throw AgentErrors.notFound(`File not found: ${absolute}`, "Check the path passed to --file.");
        const payload = JSON.parse(readFileSync(absolute, "utf-8")) as { context?: Partial<ProjectContext> };
        const result = writeProjectContext(rootDir, payload.context ?? {});
        if (wantsJsonOutput()) {
          printJson(result);
        } else {
          console.log(`\n  imported context from ${absolute}\n`);
        }
        break;
      }

      if (subCommand === "doctor") {
        const summary = {
          stage: {
            value: explicitStage ?? configStage ?? projectContext.stage ?? process.env.WD_STAGE ?? defaultUserStage(),
            source: explicitStage ? "flag" : configStage ? "config" : projectContext.stage ? ".wdrc" : process.env.WD_STAGE ? "env:WD_STAGE" : "default:$USER",
          },
          accountId: {
            value: process.env.CLOUDFLARE_ACCOUNT_ID ?? projectContext.accountId ?? null,
            source: process.env.CLOUDFLARE_ACCOUNT_ID ? "env:CLOUDFLARE_ACCOUNT_ID" : projectContext.accountId ? ".wdrc" : "none",
          },
          telemetry: {
            value: projectContext.telemetry ?? false,
            source: projectContext.telemetry !== undefined ? ".wdrc" : "default:false",
          },
        };
        if (wantsJsonOutput()) {
          printJson(summary);
          break;
        }
        console.log("\n  context doctor\n");
        console.log(`  stage: ${summary.stage.value} (${summary.stage.source})`);
        console.log(`  accountId: ${summary.accountId.value ?? "unset"} (${summary.accountId.source})`);
        console.log(`  telemetry: ${summary.telemetry.value} (${summary.telemetry.source})\n`);
        break;
      }

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
          "telemetry",
        ];
        const keyName = getFlag("key") ?? args[2];

        if (!keyName) {
          // No key — print all values (same as `wd context`)
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
            console.log("  (no defaults found — set one with `wd context set --stage <name>`)");
          }
          console.log("");
          break;
        }

        if (!validKeys.includes(keyName as keyof ProjectContext)) {
          throw new UsageError(
            `Unknown key "${keyName}". Valid keys: ${validKeys.join(", ")}`,
          );
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
        if (getFlag("telemetry") !== undefined) updates.telemetry = getFlag("telemetry") === "true";

        if (Object.keys(updates).length === 0) {
          throw AgentErrors.validation(
            "context set requires at least one flag: --stage, --fallback-stage, --base-port, --filter, --session, --persist-to, --account-id, --database-url, --state-password, or --telemetry",
            "Pass at least one of the supported flags to update the project context.",
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
          telemetry: boolean;
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
        if (hasFlag("telemetry")) keys.push("telemetry");

        if (keys.length === 0) {
          throw AgentErrors.validation(
            "context unset requires at least one flag: --stage, --fallback-stage, --base-port, --filter, --session, --persist-to, --account-id, --database-url, --state-password, or --telemetry",
            "Pass at least one of the supported flags to clear from the project context.",
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

    case "state": {
      const subCommand = args[1];
      if (!subCommand || !["list", "get", "tree"].includes(subCommand)) {
        throw AgentErrors.validation(`state requires a subcommand: list, get <resource>, or tree`, "Run `wd state list`, `wd state get <resource>`, or `wd state tree`.");
      }

      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      if (!stageState) {
        const result = { stage, exists: false, message: `no state for stage "${stage}"` };
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }
        console.log(`\n  no state found for stage "${stage}". Run "wd apply --stage ${stage}" first.\n`);
        break;
      }

      if (subCommand === "list") {
        const entries = buildStateList(stageState);
        if (wantsJsonOutput()) {
          printJson({ stage, resources: entries });
          break;
        }
        process.stdout.write(renderStateListText(stageState));
        break;
      }

      if (subCommand === "get") {
        const resourceName = args[2];
        if (!resourceName) throw AgentErrors.validation("state get <resource> requires a resource name", "Pass a resource name as the third argument: `wd state get <resource>`.");
        const entry = getStateEntry(stageState, resourceName);
        if (!entry) {
          throw AgentErrors.notFound(`Resource "${resourceName}" not found in stage "${stage}"`, "Run `wd state list` to see available resources.");
        }
        if (wantsJsonOutput()) {
          printJson(entry);
          break;
        }
        process.stdout.write(renderStateGetText(entry));
        break;
      }

      if (subCommand === "tree") {
        const tree = buildStateTree(stageState, config);
        if (wantsJsonOutput()) {
          printJson({ stage, tree });
          break;
        }
        process.stdout.write(renderTreeAscii(tree));
        break;
      }
      break;
    }

    case "run": {
      const config = await loadConfig(rootDir);
      const validationErrors = validateConfig(config);
      if (validationErrors.length > 0) {
        const result = { ok: false, errors: validationErrors };
        if (wantsJsonOutput()) {
          printJson(result);
          process.exit(1);
        }
        console.error(`\n  config errors (${validationErrors.length}):\n`);
        for (const error of validationErrors) {
          console.error(`    ✗ ${error}`);
        }
        console.error("");
        process.exit(1);
      }

      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      const summary = {
        ok: true,
        readOnly: true,
        stage,
        workers: config.workers ?? [],
        resources: Object.fromEntries(
          Object.entries(config.resources).map(([name, resource]) => [name, { type: (resource as { type: string }).type }]),
        ),
        stagedResources: stageState ? Object.keys(stageState.resources).length : 0,
        deployedWorkers: stageState
          ? Object.values(stageState.workers).filter((w) => w.deployed).length
          : 0,
      };

      if (wantsJsonOutput()) {
        printJson(summary);
        break;
      }

      console.log(`\n  wrangler-deploy run --stage ${stage}  (read-only)\n`);
      console.log(`  config: ok`);
      console.log(`  workers (${summary.workers.length}): ${summary.workers.join(", ")}`);
      console.log(`  resources (${Object.keys(summary.resources).length}): ${Object.keys(summary.resources).join(", ")}`);
      if (stageState) {
        console.log(`  state: ${summary.stagedResources} resources, ${summary.deployedWorkers}/${summary.workers.length} workers deployed`);
      } else {
        console.log(`  state: none yet`);
      }
      console.log("");
      break;
    }

    case "rotate-password": {
      const oldPw = getFlag("old-password") ?? process.env.WD_STATE_PASSWORD_OLD;
      const newPw = getFlag("new-password") ?? process.env.WD_STATE_PASSWORD_NEW;
      if (!oldPw) throw AgentErrors.validation("--old-password (or WD_STATE_PASSWORD_OLD) is required", "Pass --old-password or set WD_STATE_PASSWORD_OLD.", { flag: "--old-password" });
      if (!newPw) throw AgentErrors.validation("--new-password (or WD_STATE_PASSWORD_NEW) is required", "Pass --new-password or set WD_STATE_PASSWORD_NEW.", { flag: "--new-password" });
      if (oldPw === newPw) throw AgentErrors.validation("--old-password and --new-password must differ", "Choose a different new password.");

      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state);
      const result = await rotatePassword({
        provider: stateProvider,
        oldPassword: oldPw,
        newPassword: newPw,
      });

      if (wantsJsonOutput()) {
        printJson(result);
        if (result.skipped.length > 0) process.exit(1);
        break;
      }
      console.log(`\n  wrangler-deploy rotate-password\n`);
      for (const stage of result.rotated) console.log(`  ✓ ${stage}`);
      for (const entry of result.skipped) console.log(`  · ${entry.stage}: ${entry.reason}`);
      console.log(`\n  ${result.rotated.length} rotated, ${result.skipped.length} skipped\n`);
      if (result.skipped.length > 0) process.exit(1);
      break;
    }

    case "configure": {
      const profileName = getFlag("profile") ?? defaultProfileName();
      const method: AuthMethod = (getFlag("method") as AuthMethod) ?? "api-token";
      if (method !== "api-token" && method !== "oauth") {
        throw AgentErrors.validation(`--method must be "api-token" or "oauth", got "${method}"`, `Pass --method api-token or --method oauth.`, { flag: "--method" });
      }
      const accountId = getFlag("account-id");
      const accountName = getFlag("account-name");

      if (hasFlag("yes") || (accountId && method === "api-token")) {
        if (!accountId) {
          throw AgentErrors.validation("--account-id is required with --yes (interactive prompts disabled)", "Pass --account-id <id> together with --yes.", { flag: "--account-id" });
        }
        const file = upsertCloudflareProfile(profileName, {
          method,
          metadata: { id: accountId, ...(accountName ? { name: accountName } : {}) },
        });
        const result = {
          profile: profileName,
          method,
          accountId,
          accountName,
          configPath: profilesConfigPath(),
          profiles: Object.keys(file.profiles),
        };
        if (wantsJsonOutput()) {
          printJson(result);
          break;
        }
        console.log(`\n  Configured profile "${profileName}" (${method}) → ${accountId}`);
        console.log(`  Saved to ${result.configPath}`);
        console.log(`\n  Next: wd login --profile ${profileName}\n`);
        break;
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

      try {
        console.log(`\n  Configuring profile "${profileName}"\n`);
        const methodAnswer = (await question(`  Auth method [api-token]: `)).trim() || "api-token";
        if (methodAnswer !== "api-token" && methodAnswer !== "oauth") {
          throw AgentErrors.validation(`method must be "api-token" or "oauth"`, `Type api-token or oauth at the prompt.`);
        }
        const idAnswer = (await question(`  Cloudflare account ID: `)).trim();
        if (!idAnswer) throw AgentErrors.validation("account ID is required", "Provide a Cloudflare account ID at the prompt.");
        const nameAnswer = (await question(`  Account name (optional): `)).trim();

        upsertCloudflareProfile(profileName, {
          method: methodAnswer as AuthMethod,
          metadata: { id: idAnswer, ...(nameAnswer ? { name: nameAnswer } : {}) },
        });

        console.log(`\n  Saved to ${profilesConfigPath()}`);
        console.log(`\n  Next: wd login --profile ${profileName}\n`);
      } finally {
        rl.close();
      }
      break;
    }

    case "login": {
      const profileName = getFlag("profile") ?? defaultProfileName();
      const profile = getProfile(profileName);
      if (!profile?.cloudflare) {
        throw AgentErrors.config(
          `Profile "${profileName}" is not configured. Run "wd configure --profile ${profileName}" first.`,
          `Run \`wd configure --profile ${profileName}\` first.`,
        );
      }

      const tokenFlag = getFlag("token") ?? process.env.CLOUDFLARE_API_TOKEN;
      let token = tokenFlag;
      if (!token) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const question = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
        try {
          console.log(`\n  Logging in to profile "${profileName}"\n`);
          console.log(`  Create a token: ${dashboardCreateUrl()}\n`);
          token = (await question(`  Cloudflare API token: `)).trim();
        } finally {
          rl.close();
        }
      }
      if (!token) throw AgentErrors.auth("No token provided.", "Pass --token <api-token> or set CLOUDFLARE_API_TOKEN.", { env: ["CLOUDFLARE_API_TOKEN"] });

      const path = writeCloudflareCredential(profileName, { type: "api-token", token });
      const result = {
        profile: profileName,
        credentialPath: path,
        accountId: profile.cloudflare.metadata?.id,
      };
      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }
      console.log(`\n  Saved credentials for "${profileName}" to ${path}\n`);
      if (profile.cloudflare.metadata?.id) {
        console.log(`  Account: ${profile.cloudflare.metadata.id}`);
        if (profile.cloudflare.metadata.name) {
          console.log(`           ${profile.cloudflare.metadata.name}`);
        }
      }
      console.log("");
      break;
    }

    case "logout": {
      const profileName = getFlag("profile") ?? defaultProfileName();
      const removed = deleteCloudflareCredential(profileName);
      const purge = hasFlag("purge");
      let configRemoved = false;
      if (purge) {
        configRemoved = removeProfile(profileName);
      }
      const result = {
        profile: profileName,
        credentialRemoved: removed,
        profileRemoved: configRemoved,
      };
      if (wantsJsonOutput()) {
        printJson(result);
        break;
      }
      if (!removed && !configRemoved) {
        console.log(`\n  Nothing to remove for profile "${profileName}".\n`);
      } else {
        console.log(`\n  Logged out of profile "${profileName}"`);
        if (removed) console.log(`    credential file deleted`);
        if (configRemoved) console.log(`    profile entry removed from config`);
        console.log("");
      }
      break;
    }

    case "profile": {
      const subCommand = args[1];
      if (subCommand === "list" || subCommand === undefined) {
        const names = listProfiles();
        const active = profileSelection.name;
        const entries = names.map((name) => {
          const profile = getProfile(name);
          return {
            name,
            active: name === active,
            method: profile?.cloudflare?.method,
            accountId: profile?.cloudflare?.metadata?.id,
            accountName: profile?.cloudflare?.metadata?.name,
            credentialPath: profileCredentialsPath(name, "cloudflare"),
          };
        });
        if (wantsJsonOutput()) {
          printJson({ active, source: profileSelection.source, profiles: entries });
          break;
        }
        if (entries.length === 0) {
          console.log(`\n  No profiles configured. Run "wd configure" to create one.\n`);
          break;
        }
        console.log(`\n  wrangler-deploy profiles  (active: ${active}, via ${profileSelection.source})\n`);
        for (const entry of entries) {
          const marker = entry.active ? "*" : " ";
          const account = entry.accountId ? ` → ${entry.accountId}` : "";
          const name = entry.accountName ? ` (${entry.accountName})` : "";
          console.log(`  ${marker} ${entry.name.padEnd(20)} ${entry.method ?? "(unconfigured)"}${account}${name}`);
        }
        console.log("");
        break;
      }
      if (subCommand === "test") {
        const profileName = getFlag("profile") ?? defaultProfileName();
        const profile = getProfile(profileName);
        if (!profile?.cloudflare) throw AgentErrors.config(`Profile "${profileName}" is not configured.`, `Run \`wd configure --profile ${profileName}\` first.`);
        const token = process.env.CLOUDFLARE_API_TOKEN;
        const accountId = profile.cloudflare.metadata?.id;
        const result = {
          profile: profileName,
          hasConfiguredAccountId: !!accountId,
          hasTokenInEnv: !!token,
          recommendedScopes: REQUIRED_SCOPES,
        };
        if (wantsJsonOutput()) {
          printJson(result);
        } else {
          console.log(`\n  profile test: ${profileName}\n`);
          console.log(`  account id: ${accountId ?? "missing"}`);
          console.log(`  token in env: ${token ? "yes" : "no"}`);
          console.log("");
        }
        if (!accountId || !token) process.exit(1);
        break;
      }
      throw AgentErrors.validation(`Unknown profile subcommand "${subCommand}". Available: list, test.`, "Run `wd profile list` or `wd profile test`.");
    }

    case "telemetry": {
      const subCommand = args[1] ?? "status";
      if (!["on", "off", "status"].includes(subCommand)) {
        throw AgentErrors.validation(`Unknown telemetry subcommand "${subCommand}". Available: on, off, status.`, "Run `wd telemetry on|off|status`.");
      }
      if (subCommand === "status") {
        const enabled = !!projectContext.telemetry;
        if (wantsJsonOutput()) {
          printJson({ telemetry: enabled });
        } else {
          console.log(`\n  telemetry: ${enabled ? "on" : "off"}\n`);
        }
        break;
      }
      const enabled = subCommand === "on";
      const result = writeProjectContext(rootDir, { telemetry: enabled });
      if (wantsJsonOutput()) {
        printJson({ telemetry: enabled, path: result.path });
      } else {
        console.log(`\n  telemetry ${enabled ? "enabled" : "disabled"} (${result.path})\n`);
      }
      break;
    }

    case "util": {
      const subCommand = args[1];
      if (subCommand === "create-cf-token") {
        const profileName = getFlag("profile") ?? defaultProfileName();
        if (wantsJsonOutput()) {
          printJson(tokenInstructionsJson({ profileName }));
          break;
        }
        process.stdout.write(renderTokenInstructions({ profileName }));
        break;
      }
      if (subCommand === "scopes") {
        if (wantsJsonOutput()) {
          printJson({ scopes: REQUIRED_SCOPES });
          break;
        }
        console.log("\n  Required Cloudflare API token scopes:\n");
        for (const scope of REQUIRED_SCOPES) {
          console.log(`    ${scope.group.padEnd(28)} ${scope.level.padEnd(5)}  ${scope.why}`);
        }
        console.log("");
        break;
      }
      throw AgentErrors.validation(`Unknown util subcommand "${subCommand}". Available: create-cf-token, scopes.`, "Run `wd util create-cf-token` or `wd util scopes`.");
    }

    case "check": {
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const pack = getFlag("pack") ?? "full";
      const checks = runDoctor(config, {
        wranglerVersion: () => runWranglerVersion(),
        wranglerAuth: () => runWranglerWhoami(),
        workerExists: (p: string) => existsSync(resolve(rootDir, p, "wrangler.jsonc")) || existsSync(resolve(rootDir, p, "wrangler.json")),
        configErrors: validateConfig(config),
      });
      const planResult = pack === "doctor-only" ? null : await plan({ stage }, { rootDir, config, state: stateProvider });
      const { ok, doctorOk, planOk } = evaluateCheck({
        pack: pack as "full" | "doctor-only" | "plan-only",
        checks,
        plan: planResult,
      });
      const summary = { ok, pack, checks, plan: planResult, doctorOk, planOk };
      if (wantsJsonOutput()) {
        printJson(summary);
        maybeWriteArtifact(summary);
      } else {
        maybeWriteArtifact(summary);
        console.log(`\n  wd check\n`);
        console.log(`  pack: ${pack}`);
        console.log(`  doctor: ${doctorOk ? "pass" : "fail"}`);
        if (planResult) console.log(`  plan: ${planOk ? "pass" : "fail"}`);
        if (planResult) console.log(`  plan items: ${planResult.items.length}\n`);
        else console.log("");
      }
      if (!ok) process.exit(1);
      break;
    }

    case "rollback": {
      const subCommand = args[1];
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      assertStageState(stageState, stage);
      const workerArgOffset = subCommand === "list" ? 2 : 1;
      const workerTarget = getFlag("worker") ?? args[workerArgOffset];
      if (subCommand === "list") {
        assertUsage(workerTarget, "Usage: wd rollback list --stage <name> --worker <worker>");
        const worker = matchWorker(stageState, workerTarget);
        if (!worker) throw AgentErrors.notFound(`No worker found matching "${workerTarget}".`, "Pass --worker <name> matching a deployed worker.");
        const versions = listKnownVersions(stageState, worker.workerPath, worker.worker.name);
        const payload = { stage, worker: worker.worker.name, workerPath: worker.workerPath, versions };
        if (wantsJsonOutput()) printJson(payload);
        else {
          console.log(`\n  rollback versions (${stage})\n`);
          console.log(`  worker: ${worker.worker.name} (${worker.workerPath})`);
          if (versions.length === 0) console.log("  no known versions in local state history");
          for (const id of versions) console.log(`  - ${id}`);
          console.log("");
        }
        break;
      }
      let version = getFlag("version") ?? args[workerArgOffset + 1];
      assertUsage(workerTarget, "Usage: wd rollback --stage <name> --worker <worker> --version <version-id|--latest>");
      const worker = matchWorker(stageState, workerTarget);
      if (!worker) throw AgentErrors.notFound(`No worker found matching "${workerTarget}".`, "Pass --worker <name> matching a deployed worker.");
      if (!version && hasFlag("latest")) {
        version = worker.worker.versionId;
      }
      if (!version) throw AgentErrors.validation("No rollback version found. Pass --version or ensure state has versionId and use --latest.", "Pass --version <id> or use --latest with stored state.", { flag: "--version" });
      const wrangler = createWranglerRunner();
      const cmd = ["versions", "deploy", version, "--name", worker.worker.name];
      if (isDryRun(args)) {
        if (wantsJsonOutput()) printJson({ dryRun: true, cmd });
        else console.log(`\n  dry-run: npx wrangler ${cmd.join(" ")}\n`);
        break;
      }
      const output = wrangler.run(cmd, rootDir);
      worker.worker.versionId = version;
      worker.worker.deployed = true;
      appendRollbackEvent(stageState, {
        workerPath: worker.workerPath,
        workerName: worker.worker.name,
        versionId: version,
        urls: worker.worker.urls ?? (worker.worker.url ? [worker.worker.url] : []),
        routes: worker.worker.routes ?? [],
      });
      stageState.updatedAt = new Date().toISOString();
      await stateProvider.write(stage, stageState);
      if (hasFlag("verify")) {
        const verifyResult = await verify({ stage }, { rootDir, config, state: stateProvider });
        if (!verifyResult.passed) throw AgentErrors.state("Rollback completed but verification failed.", "Inspect the verification output and re-run `wd verify` after fixing the worker.");
      }
      if (wantsJsonOutput()) printJson({ rolledBack: worker.worker.name, version, output, verified: hasFlag("verify") });
      else console.log(`\n  rolled back ${worker.worker.name} to ${version}${hasFlag("verify") ? " (verified)" : ""}\n`);
      break;
    }

    case "macro": {
      const sub = args[1];
      const macros = readMacros(rootDir);
      if (sub === "list" || !sub) {
        if (wantsJsonOutput()) printJson({ macros });
        else {
          console.log("\n  macros\n");
          for (const [name, commands] of Object.entries(macros)) console.log(`  ${name}: ${commands.join(" && ")}`);
          console.log("");
        }
        break;
      }
      if (sub === "save") {
        const name = args[2];
        const body = args.slice(3).filter((arg) => !arg.startsWith("--") && arg !== "-q").join(" ").trim();
        assertUsage(name && body, "Usage: wd macro save <name> <cmd1 && cmd2 ...>");
        const commands = splitMacroBody(body);
        if (isDryRun(args)) {
          const preview = { ok: true, dryRun: true, name, commands, wouldOverwrite: Boolean(macros[name]) };
          if (wantsJsonOutput()) printJson(preview);
          else {
            console.log(`\n  [dry-run] macro ${name} would be saved with ${commands.length} command(s):`);
            for (const c of commands) console.log(`    - ${c}`);
            console.log("");
          }
          maybeWriteArtifact(preview);
          break;
        }
        macros[name] = commands;
        writeMacros(rootDir, macros);
        const result = { ok: true, saved: name, commands: macros[name] };
        if (wantsJsonOutput()) printJson(result);
        else console.log(`\n  saved macro ${name}\n`);
        maybeWriteArtifact(result);
        break;
      }
      if (sub === "run") {
        const name = args[2];
        if (!name || !macros[name]) throw AgentErrors.notFound(`Unknown macro "${name}"`, "Run `wd macro list` to see saved macros.");
        if (hasFlag("dry-run")) {
          if (wantsJsonOutput()) printJson({ name, commands: macros[name], dryRun: true });
          else {
            console.log(`\n  macro ${name} (dry-run)\n`);
            for (const commandText of macros[name]!) console.log(`  - ${commandText}`);
            console.log("");
          }
          break;
        }
        for (const commandText of macros[name]!) {
          execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...tokenizeCommandText(commandText)], { cwd: rootDir, stdio: "inherit" });
        }
        break;
      }
      if (sub === "validate") {
        const known = new Set(cliManifest.commands.map((c) => c.name));
        const errors: Array<{ macro: string; command: string; error: string }> = [];
        for (const [macroName, commands] of Object.entries(macros)) {
          for (const commandText of commands) {
            let cmd: string | undefined;
            try {
              cmd = macroCommandName(commandText);
            } catch {
              errors.push({ macro: macroName, command: commandText, error: "invalid quoting" });
              continue;
            }
            if (!cmd || !known.has(cmd)) {
              errors.push({ macro: macroName, command: commandText, error: "unknown command" });
            }
          }
        }
        if (wantsJsonOutput()) printJson({ valid: errors.length === 0, errors });
        else {
          console.log(`\n  macro validate\n`);
          if (errors.length === 0) console.log("  all macros valid");
          for (const e of errors) console.log(`  x ${e.macro}: ${e.command} (${e.error})`);
          console.log("");
        }
        if (errors.length > 0) process.exit(1);
        break;
      }
      throw AgentErrors.validation(`Unknown macro subcommand "${sub}". Available: list, save, run, validate.`, "Run `wd macro list|save|run|validate`.");
    }

    case "history": {
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      assertStageState(stageState, stage);
      const workerTarget = getFlag("worker");
      const entries = (stageState.deploymentHistory ?? []).filter((event) =>
        workerTarget ? event.workerPath === workerTarget || event.workerName === workerTarget : true
      );
      if (wantsJsonOutput()) {
        printJson({ stage, count: entries.length, history: entries });
      } else {
        console.log(`\n  history (${stage})\n`);
        if (entries.length === 0) {
          console.log("  no deployment history recorded yet\n");
        } else {
          for (const event of entries) {
            const version = event.versionId ? ` version=${event.versionId}` : "";
            console.log(`  - ${event.at} ${event.action} ${event.workerName} (${event.workerPath})${version}`);
          }
          console.log("");
        }
      }
      break;
    }

    case "env": {
      const sub = args[1];
      if (sub !== "diff") throw AgentErrors.validation(`Unknown env subcommand "${sub}". Available: diff.`, "Run `wd env diff --stage <name> --worker <worker-path>`.");
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const workerPath = getFlag("worker") ?? args[2];
      assertUsage(workerPath, "Usage: wd env diff --stage <name> --worker <worker-path>");
      if (!config.workers.includes(workerPath)) throw AgentErrors.notFound(`Unknown worker "${workerPath}" in config.workers.`, "Pass --worker <path> matching one of `config.workers`.");
      const sourcePath = resolve(rootDir, workerPath, "wrangler.jsonc");
      const renderedPath = resolve(rootDir, ".wrangler-deploy", stage, workerPath, "wrangler.rendered.jsonc");
      if (!existsSync(sourcePath)) throw AgentErrors.notFound(`Source wrangler config not found: ${sourcePath}`, "Add a `wrangler.jsonc` file at the worker path.");
      if (!existsSync(renderedPath)) throw AgentErrors.notFound(`Rendered config not found for stage "${stage}". Run wd apply first.`, `Run \`wd apply --stage ${stage}\` first.`);
      const source = readFileSync(sourcePath, "utf-8");
      const rendered = readFileSync(renderedPath, "utf-8");
      const summary = summarizeEnvDiff(source, rendered);
      const payload = { stage, workerPath, sourcePath, renderedPath, ...summary };
      if (wantsJsonOutput()) printJson(payload);
      else {
        console.log(`\n  env diff (${stage}) ${workerPath}\n`);
        console.log(`  source:   ${sourcePath}`);
        console.log(`  rendered: ${renderedPath}`);
        console.log(`  changed lines: ${summary.changedLines} (source ${summary.baseLines}, rendered ${summary.renderedLines})\n`);
      }
      break;
    }

    case "lock": {
      const sub = args[1] ?? "status";
      assertStage(stage);
      if (sub === "status") {
        const lock = readDeployLock(rootDir, stage);
        if (wantsJsonOutput()) printJson({ stage, locked: !!lock, lock });
        else console.log(`\n  lock ${stage}: ${lock ? `locked by ${lock.owner} (${lock.createdAt})` : "unlocked"}\n`);
        break;
      }
      if (sub === "acquire") {
        const existing = readDeployLock(rootDir, stage);
        if (existing) throw AgentErrors.state(`Stage "${stage}" already locked by ${existing.owner}.`, `Run \`wd lock release --stage ${stage}\` to release the lock.`);
        const lock = writeDeployLock(rootDir, stage);
        if (wantsJsonOutput()) printJson({ stage, acquired: true, lock });
        else console.log(`\n  lock acquired for ${stage} by ${lock.owner}\n`);
        break;
      }
      if (sub === "release") {
        clearDeployLock(rootDir, stage);
        if (wantsJsonOutput()) printJson({ stage, released: true });
        else console.log(`\n  lock released for ${stage}\n`);
        break;
      }
      throw AgentErrors.validation(`Unknown lock subcommand "${sub}". Available: status, acquire, release.`, "Run `wd lock status|acquire|release`.");
    }

    case "replay": {
      const file = getFlag("file") ?? args[1];
      assertUsage(file, "Usage: wd replay --file <path> --worker <worker-path>");
      const config = await loadConfig(rootDir);
      const workerPath = getFlag("worker");
      assertUsage(workerPath, "Usage: wd replay --file <path> --worker <worker-path>");
      const content = readFileSync(resolve(rootDir, file), "utf-8");
      const lines = content.split("\n").filter(Boolean);
      const calls: Array<{ status: number; ok: boolean }> = [];
      for (const line of lines) {
        const entry = JSON.parse(line) as { method?: string; path?: string; headers?: Record<string, string>; body?: string };
        const result = await callWorker(config, rootDir, {
          worker: workerPath,
          method: entry.method ?? "GET",
          path: entry.path ?? "/",
          headers: entry.headers,
          body: entry.body,
        });
        calls.push({ status: result.status, ok: result.ok });
      }
      const payload = {
        worker: workerPath,
        file,
        total: calls.length,
        failed: calls.filter((c) => !c.ok).length,
        statuses: calls.map((c) => c.status),
      };
      if (wantsJsonOutput()) printJson(payload);
      else console.log(`\n  replay ${workerPath}: ${payload.total - payload.failed}/${payload.total} succeeded\n`);
      if (payload.failed > 0) process.exit(1);
      break;
    }

    case "route": {
      const sub = args[1];
      if (sub !== "verify" && sub !== "apply") throw AgentErrors.validation(`Unknown route subcommand "${sub}". Use verify|apply.`, "Run `wd route verify` or `wd route apply`.");
      const config = await loadConfig(rootDir);
      const routes = config.routes ?? {};
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const [workerPath, routeConfig] of Object.entries(routes)) {
        const values = Array.isArray(routeConfig) ? routeConfig : [routeConfig];
        for (const raw of values) {
          const key = `${workerPath}:${raw}`;
          if (seen.has(key)) duplicates.push(key);
          seen.add(key);
        }
      }
      const result = { routes: Object.keys(routes).length, duplicates, valid: duplicates.length === 0 };
      const zoneId = getFlag("zone-id");
      const shouldUseApi = !!zoneId && !!process.env.CLOUDFLARE_API_TOKEN && !!stage;
      type RouteRecord = { id: string; pattern: string; script: string };
      const apiCall = async (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ success: boolean; result: unknown; errors?: Array<{ message?: string }> }> => {
        const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = (await res.json()) as { success: boolean; result: unknown; errors?: Array<{ message?: string }> };
        if (!res.ok || !payload.success) {
          const message = payload.errors?.map((e) => e.message).filter(Boolean).join(", ") || `${res.status} ${res.statusText}`;
          throw new Error(message);
        }
        return payload;
      };
      const flatten = (value: string | string[]) => (Array.isArray(value) ? value : [value]);
      if (wantsJsonOutput()) printJson(result);
      else {
        console.log(`\n  route ${sub}\n`);
        console.log(`  workers with routes: ${result.routes}`);
        console.log(`  duplicates: ${duplicates.length}`);
        if (sub === "apply" && !shouldUseApi) {
          console.log("  set --zone-id + --stage + CLOUDFLARE_API_TOKEN to apply routes via Cloudflare API");
        }
        console.log("");
      }
      if (sub === "apply" && shouldUseApi) {
        const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
        const state = await stateProvider.read(stage!);
        if (!state) throw AgentErrors.state(`No state for stage "${stage}". Run wd apply first.`, `Run \`wd apply --stage ${stage}\` first.`);
        const desired: Array<{ pattern: string; script: string }> = [];
        for (const [workerPath, routeConfig] of Object.entries(routes)) {
          const script = state.workers[workerPath]?.name;
          if (!script) throw AgentErrors.state(`No deployed worker name for route owner "${workerPath}" in stage "${stage}".`, `Run \`wd deploy --stage ${stage}\` so the worker has a deployed name.`);
          for (const pattern of flatten(routeConfig as string | string[])) desired.push({ pattern, script });
        }
        const existingResp = await apiCall("GET", `/zones/${zoneId}/workers/routes`);
        const existing = (existingResp.result as RouteRecord[]) ?? [];
        const desiredKey = new Set(desired.map((r) => `${r.script}|${r.pattern}`));
        const managedScripts = new Set(desired.map((r) => r.script));
        const rollbackActions: Array<() => Promise<void>> = [];
        try {
          for (const route of desired) {
            const exact = existing.find((r) => r.pattern === route.pattern && r.script === route.script);
            if (exact) continue;
            const samePattern = existing.find((r) => r.pattern === route.pattern);
            if (samePattern) {
              await apiCall("PUT", `/zones/${zoneId}/workers/routes/${samePattern.id}`, { pattern: route.pattern, script: route.script });
              rollbackActions.push(async () => {
                await apiCall("PUT", `/zones/${zoneId}/workers/routes/${samePattern.id}`, { pattern: samePattern.pattern, script: samePattern.script });
              });
              continue;
            }
            const created = await apiCall("POST", `/zones/${zoneId}/workers/routes`, { pattern: route.pattern, script: route.script });
            const createdId = (created.result as RouteRecord).id;
            rollbackActions.push(async () => {
              await apiCall("DELETE", `/zones/${zoneId}/workers/routes/${createdId}`);
            });
          }
          const toDelete = existing.filter((r) => managedScripts.has(r.script) && !desiredKey.has(`${r.script}|${r.pattern}`));
          for (const item of toDelete) {
            await apiCall("DELETE", `/zones/${zoneId}/workers/routes/${item.id}`);
            rollbackActions.push(async () => {
              await apiCall("POST", `/zones/${zoneId}/workers/routes`, { pattern: item.pattern, script: item.script });
            });
          }
          if (wantsJsonOutput()) {
            printJson({ ...result, applied: true, zoneId, desired: desired.length });
          } else {
            console.log(`  applied ${desired.length} desired route mappings in zone ${zoneId}\n`);
          }
        } catch (error) {
          for (const rollback of rollbackActions.reverse()) {
            try {
              await rollback();
            } catch {
              // best effort
            }
          }
          throw new Error(`Route apply failed and rollback attempted: ${(error as Error).message}`);
        }
      }
      if (!result.valid) process.exit(1);
      break;
    }

    case "onboard": {
      const targetStage = stage ?? `dev-${process.env.USER ?? "user"}`;
      const commands = [
        "wd configure",
        `wd context set --stage ${targetStage}`,
        `wd plan --stage ${targetStage}`,
        `wd apply --stage ${targetStage}`,
        `wd deploy --stage ${targetStage}`,
        `wd check --stage ${targetStage}`,
      ];
      if (wantsJsonOutput()) printJson({ stage: targetStage, commands });
      else {
        console.log("\n  onboarding sequence\n");
        for (const c of commands) console.log(`  - ${c}`);
        console.log("");
      }
      break;
    }

    case "quickstart": {
      const inferredStage = stage ?? "dev";
      const commands = [
        `wd context set --stage ${inferredStage}`,
        `wd plan --stage ${inferredStage}`,
        `wd apply --stage ${inferredStage}`,
        `wd deploy --stage ${inferredStage}`,
        `wd open --stage ${inferredStage} --latest`,
      ];
      if (wantsJsonOutput()) {
        printJson({ stage: inferredStage, commands });
      } else {
        console.log("\n  quickstart\n");
        for (const c of commands) console.log(`  - ${c}`);
        console.log("");
      }
      break;
    }

    case "release-note": {
      assertStage(stage);
      const config = await loadConfig(rootDir);
      const stateProvider = resolveStateProvider(rootDir, config.state, resolveStatePassword(config, projectContext));
      const stageState = await stateProvider.read(stage);
      assertStageState(stageState, stage);
      const snapshotFile = releaseSnapshotPath(rootDir, stage);
      const previous = existsSync(snapshotFile)
        ? JSON.parse(readFileSync(snapshotFile, "utf-8")) as typeof stageState
        : null;
      const workersChanged = Object.keys(stageState.workers).filter((key) =>
        JSON.stringify(stageState.workers[key]) !== JSON.stringify(previous?.workers?.[key]),
      );
      const resourcesChanged = Object.keys(stageState.resources).filter((key) =>
        JSON.stringify(stageState.resources[key]) !== JSON.stringify(previous?.resources?.[key]),
      );
      const note = {
        stage,
        updatedAt: stageState.updatedAt,
        workersChanged,
        resourcesChanged,
        secretsDeclared: Object.keys(stageState.secrets ?? {}),
      };
      if (hasFlag("mark-success")) {
        mkdirSync(resolve(rootDir, ".wrangler-deploy"), { recursive: true });
        writeFileSync(snapshotFile, `${JSON.stringify(stageState, null, 2)}\n`);
      }
      if (wantsJsonOutput()) {
        printJson(note);
      } else {
        console.log(`\n  release-note (${stage})\n`);
        console.log(`  workers changed: ${workersChanged.length}`);
        for (const w of workersChanged) console.log(`    - ${w}`);
        console.log(`  resources changed: ${resourcesChanged.length}`);
        for (const r of resourcesChanged) console.log(`    - ${r}`);
        console.log("");
      }
      break;
    }

    default:
      throw new UsageError(`Unknown command "${command}". Run \`wd\` (no args) to see available commands.`);
  }
}

main().catch((err) => {
  const commandName = command ? `wd ${command}${args[1] && !args[1].startsWith("--") ? ` ${args[1]}` : ""}` : "wd";
  const usage = isUsageError(err);
  const extraSuggestions: string[] = [];
  if (usage) {
    extraSuggestions.push(`Run \`wd ${command ?? ""} --help\` for usage.`.replace("  ", " "));
  }
  const envelope = buildErrorEnvelope(err, commandName, extraSuggestions);
  if (usage) {
    envelope.error.type = "validation";
    envelope.error.code = "WD_E_VALIDATION";
    envelope.error.fix = undefined;
    envelope.error.suggestions = extraSuggestions;
    envelope.error.retryable = false;
  } else if (envelope.error.code === "WD_E_UNKNOWN") {
    extraSuggestions.push("Run `wd explain --from-last-error` for guided remediation.");
  } else {
    extraSuggestions.push(`Run \`wd explain ${envelope.error.code}\` for more detail.`);
  }
  // Re-build to merge any newly-pushed extra suggestions (deduped).
  // Drop the classifier's generic `fix` when the error message already contains
  // a remediation — otherwise the user sees "Run X" twice. classifier `fix` is
  // also pushed into envelope.error.suggestions by buildErrorEnvelope, so filter
  // that out too.
  const messageHasRemediation = /\b[Rr]un `wd /.test(envelope.error.message);
  const baseFix = envelope.error.fix && !messageHasRemediation ? envelope.error.fix : undefined;
  const upstream = (envelope.error.suggestions ?? []).filter((s) => s !== envelope.error.fix || !messageHasRemediation);
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const s of [
    baseFix,
    ...upstream,
    ...extraSuggestions,
  ].filter((s): s is string => Boolean(s))) {
    if (!seen.has(s)) {
      seen.add(s);
      suggestions.push(s);
    }
  }
  envelope.error.suggestions = suggestions.length > 0 ? suggestions : undefined;

  try {
    const rootDir = resolveRootDir();
    mkdirSync(resolve(rootDir, ".wrangler-deploy"), { recursive: true });
    writeFileSync(
      lastErrorPath(rootDir),
      `${JSON.stringify({
        at: new Date().toISOString(),
        command: commandName,
        type: envelope.error.type,
        code: envelope.error.code,
        message: envelope.error.message,
        retryable: envelope.error.retryable,
        fix: envelope.error.fix,
      }, null, 2)}\n`,
    );
  } catch {
    // best effort only
  }
  if (wantsJsonOutput()) {
    printJson(envelope);
  } else {
    const suggestionText = suggestions.length > 0 ? `\n  ${suggestions.join("\n  ")}` : "";
    console.error(`\n  ✗ ${commandName} failed [${envelope.error.code}]\n\n  ${envelope.error.message}${suggestionText}\n`);
  }
  // Exit 2 for validation/usage errors so agents can distinguish from runtime failures.
  process.exit(envelope.error.type === "validation" ? 2 : 1);
});
