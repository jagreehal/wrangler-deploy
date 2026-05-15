import { existsSync, mkdirSync, readFileSync, readSync as readSyncFs, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

export type OutputFormat = "text" | "json";

export interface JsonOutputOptions {
  fields?: string[];
  ndjson?: boolean;
}

export type AgentErrorType =
  | "auth"
  | "validation"
  | "network"
  | "config"
  | "state"
  | "not_found"
  | "permission"
  | "sandbox"
  | "unknown";

export interface AgentError {
  type: AgentErrorType;
  code: string;
  message: string;
  retryable: boolean;
  fix?: string;
  expected?: unknown;
  suggestions?: string[];
}

export interface AgentErrorEnvelope {
  ok: false;
  error: AgentError;
  command?: string;
}

/**
 * Error class that carries a structured AgentError payload. Throw this from any call site that
 * has enough context to classify the failure (auth, validation, state, etc.) so the catch
 * handler skips regex-based classification and uses the payload directly.
 */
export class AgentErrorException extends Error {
  readonly agentError: AgentError;
  constructor(payload: Omit<AgentError, "message"> & { message: string }) {
    super(payload.message);
    this.name = "AgentErrorException";
    this.agentError = payload;
  }
}

/**
 * Throw a typed agent error. Preferred over `throw new Error(...)` whenever the call site knows
 * the error's type/code/fix.
 */
export function throwAgentError(payload: Omit<AgentError, "suggestions"> & { suggestions?: string[] }): never {
  throw new AgentErrorException(payload);
}

/**
 * Assert a condition; throw a typed agent error if it fails. Lighter-weight than wrapping every
 * throw in an if/else.
 */
export function assertAgentError(
  condition: unknown,
  payload: Omit<AgentError, "suggestions"> & { suggestions?: string[] },
): asserts condition {
  if (!condition) throwAgentError(payload);
}

/**
 * Convenience builders for the most-common error shapes. Use these to avoid restating type/code/fix
 * at every call site.
 */
/**
 * Assert that a stage was resolved. Throws WD_E_VALIDATION with the standard fix when missing.
 */
export function assertStage(stage: string | undefined, commandName?: string): asserts stage is string {
  if (!stage) {
    throwAgentError({
      type: "validation",
      code: "WD_E_VALIDATION",
      message: commandName
        ? `${commandName} requires --stage <name>.`
        : "--stage is required.",
      retryable: false,
      fix: "Pass --stage <name>, set WD_STAGE, or persist via `wd context set --stage <name>`.",
      expected: { flag: "--stage" },
    });
  }
}

/**
 * Assert that stage state was loaded. Throws WD_E_STATE_MISSING with the standard fix when null.
 */
export function assertStageState<T>(state: T | null | undefined, stageName: string): asserts state is T {
  if (state === null || state === undefined) {
    throwAgentError({
      type: "state",
      code: "WD_E_STATE_MISSING",
      message: `No state found for stage "${stageName}".`,
      retryable: false,
      fix: `Run \`wd apply --stage ${stageName}\` first to create stage state.`,
      expected: { stage: stageName },
    });
  }
}

/**
 * Assert a usage condition; on failure throw a validation error with the canonical Usage string.
 */
export function assertUsage(condition: unknown, usage: string): asserts condition {
  if (!condition) {
    throwAgentError({
      type: "validation",
      code: "WD_E_VALIDATION",
      message: usage,
      retryable: false,
      fix: usage.startsWith("Usage:") ? usage : `Usage: ${usage}`,
    });
  }
}

export const AgentErrors = {
  validation(message: string, fix?: string, expected?: unknown): never {
    return throwAgentError({
      type: "validation",
      code: "WD_E_VALIDATION",
      message,
      retryable: false,
      ...(fix ? { fix } : {}),
      ...(expected !== undefined ? { expected } : {}),
    });
  },
  notFound(message: string, fix?: string): never {
    return throwAgentError({
      type: "not_found",
      code: "WD_E_NOT_FOUND",
      message,
      retryable: false,
      ...(fix ? { fix } : {}),
    });
  },
  config(message: string, fix?: string): never {
    return throwAgentError({
      type: "config",
      code: "WD_E_CONFIG_MISSING",
      message,
      retryable: false,
      ...(fix ? { fix } : { fix: "Run `wd init` to scaffold a config." }),
    });
  },
  state(message: string, fix?: string): never {
    return throwAgentError({
      type: "state",
      code: "WD_E_STATE_MISSING",
      message,
      retryable: false,
      ...(fix ? { fix } : { fix: "Run `wd apply --stage <name>` first to create state." }),
    });
  },
  staleRender(message: string, fix?: string, expected?: unknown): never {
    return throwAgentError({
      type: "state",
      code: "WD_E_RENDERED_CONFIG_STALE",
      message,
      retryable: false,
      ...(fix ? { fix } : { fix: "Re-run `wd apply --stage <name>` to refresh the rendered config." }),
      ...(expected !== undefined ? { expected } : {}),
    });
  },
  auth(message: string, fix?: string, expected?: unknown): never {
    return throwAgentError({
      type: "auth",
      code: "WD_E_AUTH_FAILED",
      message,
      retryable: false,
      ...(fix ? { fix } : { fix: "Run `wd login` or set CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID." }),
      ...(expected !== undefined ? { expected } : {}),
    });
  },
  network(message: string, fix?: string): never {
    return throwAgentError({
      type: "network",
      code: "WD_E_NETWORK",
      message,
      retryable: true,
      ...(fix ? { fix } : { fix: "Retry. If persistent, check connectivity and proxy settings." }),
    });
  },
  permission(message: string, fix?: string): never {
    return throwAgentError({
      type: "permission",
      code: "WD_E_PERMISSION",
      message,
      retryable: false,
      ...(fix ? { fix } : { fix: "Check filesystem permissions on the target path." }),
    });
  },
};

let activeJsonOutputOptions: JsonOutputOptions = {};
let quietMode = false;
let noColor = false;
let noInteractive = false;
let noSecretsInOutput = false;
let sandboxMode = false;
let activeOutputFile: string | undefined;
let outputFileWritten = false;

export function setJsonOutputOptions(options: JsonOutputOptions): void {
  activeJsonOutputOptions = options;
}

export function setQuietMode(quiet: boolean): void {
  quietMode = quiet;
}

export function isQuiet(): boolean {
  return quietMode;
}

export function setNoColor(value: boolean): void {
  noColor = value;
  if (value) {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "0";
  }
}

export function isNoColor(): boolean {
  return noColor;
}

export function setNoInteractive(value: boolean): void {
  noInteractive = value;
  if (value) process.env.WD_NO_INTERACTIVE = "1";
}

export function isNoInteractive(): boolean {
  return noInteractive;
}

export function setNoSecretsInOutput(value: boolean): void {
  noSecretsInOutput = value;
}

export function isNoSecretsInOutput(): boolean {
  return noSecretsInOutput;
}

export function setSandboxMode(value: boolean): void {
  sandboxMode = value;
  if (value) process.env.AGENT_SANDBOX = "1";
}

export function isSandboxMode(): boolean {
  return sandboxMode;
}

export function setOutputFile(value: string | undefined): void {
  activeOutputFile = value;
  outputFileWritten = false;
}

export function getOutputFile(): string | undefined {
  return activeOutputFile;
}

export function hasOutputFileBeenWritten(): boolean {
  return outputFileWritten;
}

export function parseQuiet(args: string[]): boolean {
  return args.includes("--quiet") || args.includes("-q");
}

export function parseNoColor(args: string[]): boolean {
  if (args.includes("--no-color")) return true;
  if (process.env.NO_COLOR && process.env.NO_COLOR !== "0") return true;
  return false;
}

export function parseNoInteractive(args: string[]): boolean {
  if (args.includes("--no-interactive")) return true;
  if (process.env.WD_NO_INTERACTIVE === "1") return true;
  if (process.env.AGENT_SANDBOX === "1") return true;
  if (process.env.CI === "true" || process.env.CI === "1") return true;
  if (!process.stdin.isTTY) return true;
  return false;
}

export function parseNoSecretsInOutput(args: string[]): boolean {
  if (args.includes("--no-secrets-in-output")) return true;
  if (process.env.WD_NO_SECRETS === "1") return true;
  if (process.env.AGENT_SANDBOX === "1") return true;
  return false;
}

export function parseSandboxMode(args: string[]): boolean {
  if (args.includes("--sandbox")) return true;
  if (process.env.AGENT_SANDBOX === "1") return true;
  return false;
}

export function info(message: string): void {
  if (quietMode) return;
  process.stdout.write(`${message}\n`);
}

function readFlagValues(args: string[], flagName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === `--${flagName}` && args[index + 1] !== undefined) {
      values.push(args[index + 1]!);
      index += 1;
      continue;
    }

    if (arg?.startsWith(`--${flagName}=`)) {
      values.push(arg.slice(flagName.length + 3));
    }
  }
  return values;
}

export function parseOutputFields(args: string[]): string[] | undefined {
  const values = readFlagValues(args, "fields")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export function parseOutputFormat(args: string[]): OutputFormat {
  const formatIndex = args.indexOf("--format");
  if (formatIndex !== -1 && ["json", "ndjson"].includes(args[formatIndex + 1] ?? "")) {
    return "json";
  }

  if (args.includes("--json") || args.includes("--ndjson")) {
    return "json";
  }

  return "text";
}

export function isDryRun(args: string[]): boolean {
  return args.includes("--dry-run");
}

export function parseInputPath(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--input" && args[index + 1] !== undefined) {
      return args[index + 1];
    }
    if (args[index]?.startsWith("--input=")) {
      return args[index]!.slice("--input=".length);
    }
  }
  return undefined;
}

export interface CommandInput {
  source: "stdin" | "file";
  path?: string;
  only?: string[];
  onlyResources?: string[];
  stage?: string;
  [key: string]: unknown;
}

export function readCommandInput(args: string[]): CommandInput | undefined {
  const input = parseInputPath(args);
  if (!input) return undefined;
  if (input === "-") {
    const stdin = readSync(0);
    if (!stdin.trim()) return { source: "stdin" };
    try {
      const parsed = JSON.parse(stdin) as Record<string, unknown>;
      return { source: "stdin", ...parsed };
    } catch (err) {
      const message = `--input reading from stdin failed to parse as JSON: ${(err as Error).message}`;
      const error = Object.assign(new Error(message), {
        agentError: {
          type: "validation" as const,
          code: "WD_E_VALIDATION",
          message,
          retryable: false,
          fix: "Pipe valid JSON: e.g., echo '{\"only\":[\"workers/api\"]}' | wd deploy --input -",
        },
      });
      throw error;
    }
  }
  const resolved = resolvePath(input);
  if (!existsSync(resolved)) {
    const message = `--input file not found: ${resolved}`;
    throw Object.assign(new Error(message), {
      agentError: { type: "not_found" as const, code: "WD_E_NOT_FOUND", message, retryable: false, fix: "Check the path." },
    });
  }
  const raw = readFileSync(resolved, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { source: "file", path: resolved, ...parsed };
  } catch (err) {
    const message = `--input file ${resolved} is not valid JSON: ${(err as Error).message}`;
    throw Object.assign(new Error(message), {
      agentError: { type: "validation" as const, code: "WD_E_VALIDATION", message, retryable: false, fix: "Validate the JSON file." },
    });
  }
}

function readSync(fd: number): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(65_536);
  // Best-effort sync read for stdin. If TTY (no piped input), bail out fast.
  if (fd === 0 && process.stdin.isTTY) return "";
  try {
    while (true) {
      const bytes = readSyncFs(fd, buf, 0, buf.length, null);
      if (!bytes) break;
      chunks.push(buf.slice(0, bytes));
    }
  } catch {
    // EOF or no data
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function parseOutputPath(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output-file" && args[index + 1] !== undefined) {
      return args[index + 1];
    }
    if (args[index]?.startsWith("--output-file=")) {
      return args[index]!.slice("--output-file=".length);
    }
  }
  return undefined;
}

const SECRET_PATTERN_LONG = /\b[a-zA-Z0-9_-]{40,}\b/g;
const SECRET_LIKE_KEYS = /^([A-Z0-9_]*?(SECRET|TOKEN|PASSWORD|KEY|API_KEY|PRIVATE)[A-Z0-9_]*)$/i;

export function redactSensitiveText(input: string): string {
  return input.replace(SECRET_PATTERN_LONG, "[REDACTED]");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (SECRET_LIKE_KEYS.test(key) && typeof raw === "string") {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = redactValue(raw);
    }
    return out;
  }
  return value;
}

export function redactForOutput(value: unknown): unknown {
  if (!noSecretsInOutput) return value;
  return redactValue(value);
}

function mergeSelected(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      target[key] = mergeSelected({ ...current }, value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

function selectField(value: unknown, path: string[]): unknown {
  if (path.length === 0) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => selectField(entry, path));
  }
  if (!isPlainObject(value)) return undefined;

  const [head, ...rest] = path;
  if (!head || !(head in value)) return undefined;
  const selected = selectField(value[head], rest);
  if (selected === undefined) return undefined;
  return { [head]: selected };
}

function filterFields(value: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => filterFields(entry, fields));
  }
  if (!isPlainObject(value)) return value;

  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    const nested = selectField(value, field.split("."));
    if (isPlainObject(nested)) {
      mergeSelected(selected, nested);
    }
  }
  return selected;
}

export function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveText(error.message);
  }

  return redactSensitiveText(String(error));
}

const ERROR_RULES: Array<{
  test: (message: string) => boolean;
  type: AgentErrorType;
  code: string;
  retryable: boolean;
  fix: string;
}> = [
  {
    test: (m) => /No state found|state.*missing|Stage not found|stage.*does not exist/i.test(m),
    type: "state",
    code: "WD_E_STATE_MISSING",
    retryable: false,
    fix: "Run `wd apply --stage <name>` first to create state and rendered configs.",
  },
  {
    test: (m) => /\b10000\b|account.*mismatch|wrong.*account/i.test(m),
    type: "auth",
    code: "WD_E_ACCOUNT_MISMATCH",
    retryable: false,
    fix: "Set CLOUDFLARE_ACCOUNT_ID to match the account that owns your CLOUDFLARE_API_TOKEN.",
  },
  {
    test: (m) => /unauthori[sz]ed|forbidden|invalid.*token|authentication failed/i.test(m),
    type: "auth",
    code: "WD_E_AUTH_FAILED",
    retryable: false,
    fix: "Run `wd login` or set CLOUDFLARE_API_TOKEN. Verify with `wd doctor`.",
  },
  {
    test: (m) => /No wrangler[-.]?(deploy)?\.config|wrangler-deploy\.config\.[jt]s.*not found|No wrangler-deploy\.config|config not found|wrangler\.jsonc/i.test(m),
    type: "config",
    code: "WD_E_CONFIG_MISSING",
    retryable: false,
    fix: "Run `wd init` to scaffold a config, or change directory into a project that has one.",
  },
  {
    test: (m) => /Cannot find (module|package) ['"]wrangler-deploy['"]|Cannot resolve module 'wrangler-deploy'/i.test(m),
    type: "config",
    code: "WD_E_DEPS_MISSING",
    retryable: false,
    fix: "Run `pnpm install` (or `npm install`) to install the `wrangler-deploy` package, then retry.",
  },
  {
    test: (m) => /ENOENT|not found|does not exist/i.test(m),
    type: "not_found",
    code: "WD_E_NOT_FOUND",
    retryable: false,
    fix: "Check the file path or command exists. Run `wd doctor` to validate the environment.",
  },
  {
    test: (m) => /ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network|timeout/i.test(m),
    type: "network",
    code: "WD_E_NETWORK",
    retryable: true,
    fix: "Retry. If it persists, check connectivity to api.cloudflare.com and any proxy settings.",
  },
  {
    test: (m) => /AGENT_SANDBOX|sandbox.*blocked|--sandbox/i.test(m),
    type: "sandbox",
    code: "WD_E_SANDBOX_BLOCKED",
    retryable: false,
    fix: "Re-run with --dry-run, or unset AGENT_SANDBOX=1 to perform the mutation.",
  },
  {
    test: (m) => /required argument|missing flag|invalid value|usage:/i.test(m),
    type: "validation",
    code: "WD_E_VALIDATION",
    retryable: false,
    fix: "Inspect the message; the missing flag/argument is named in the error.",
  },
  {
    test: (m) => /permission denied|EACCES/i.test(m),
    type: "permission",
    code: "WD_E_PERMISSION",
    retryable: false,
    fix: "Check filesystem permissions on the target path.",
  },
];

export function classifyError(error: unknown): AgentError {
  const message = formatCliError(error);

  // Fast path: AgentErrorException carries the structured payload directly.
  if (error instanceof AgentErrorException) {
    return error.agentError;
  }

  // Allow callers to attach a typed error to a plain Error via .agentError.
  if (error instanceof Error && (error as Error & { agentError?: AgentError }).agentError) {
    const attached = (error as Error & { agentError?: AgentError }).agentError!;
    return {
      ...attached,
      message: attached.message ?? message,
    };
  }

  for (const rule of ERROR_RULES) {
    if (rule.test(message)) {
      return {
        type: rule.type,
        code: rule.code,
        message,
        retryable: rule.retryable,
        fix: rule.fix,
      };
    }
  }

  return {
    type: "unknown",
    code: "WD_E_UNKNOWN",
    message,
    retryable: false,
    fix: "Run `wd explain --from-last-error` for guided remediation.",
  };
}

export function buildErrorEnvelope(error: unknown, commandName: string, extraSuggestions: string[] = []): AgentErrorEnvelope {
  const classified = classifyError(error);
  const suggestions = [
    ...(classified.fix ? [classified.fix] : []),
    ...extraSuggestions,
  ];
  return {
    ok: false,
    command: commandName,
    error: {
      ...classified,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    },
  };
}

export function printJson(data: unknown): void {
  const redacted = redactForOutput(data);
  const selected = filterFields(redacted, activeJsonOutputOptions.fields);
  if (activeJsonOutputOptions.ndjson) {
    if (Array.isArray(selected)) {
      for (const entry of selected) {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
      }
    } else {
      process.stdout.write(`${JSON.stringify(selected)}\n`);
    }
  } else {
    process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
  }

  // Auto-persist the first emitted JSON payload when --output-file is set.
  // Subsequent printJson calls (e.g., status --watch ticks) are not re-persisted to avoid churn.
  if (activeOutputFile && !outputFileWritten) {
    writeArtifactFile(activeOutputFile, data);
    outputFileWritten = true;
  }
}

export function writeArtifactFile(targetPath: string, data: unknown): void {
  const resolved = resolvePath(targetPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const redacted = redactForOutput(data);
  writeFileSync(resolved, `${JSON.stringify(redacted, null, 2)}\n`);
}

export interface SandboxDecision {
  blocked: boolean;
  message?: string;
}

export function enforceSandboxGuard(commandName: string, options: { mutating: boolean; dryRun: boolean }): SandboxDecision {
  if (!sandboxMode) return { blocked: false };
  if (!options.mutating) return { blocked: false };
  if (options.dryRun) return { blocked: false };
  return {
    blocked: true,
    message:
      `AGENT_SANDBOX is set: refusing to run mutating command "${commandName}" without --dry-run. ` +
      "Re-run with --dry-run, or unset AGENT_SANDBOX (or omit --sandbox) to allow the mutation.",
  };
}
