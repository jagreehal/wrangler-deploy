import { adoptSupportedResourceTypes } from "./resource-capabilities.js";

export interface CliCommandManifest {
  name: string;
  description: string;
  flags?: string[];
  subcommands?: string[];
  /** True if the command performs writes (state, network mutations, files). */
  mutating?: boolean;
  /** True if the command requires Cloudflare auth (token/account). */
  requiresAuth?: boolean;
  /** True if the command requires a stage (resolved via flag, env, or .wdrc). */
  requiresStage?: boolean;
  /** True if the command writes files to disk under the project. */
  writesFiles?: boolean;
  /** True if the command makes network calls. */
  network?: boolean;
  /** True if the command supports --dry-run for previewing without side effects. */
  supportsDryRun?: boolean;
  output?: "text" | "json" | "table" | "graph";
}

const GLOBAL_FLAGS = [
  "--json",
  "--ndjson",
  "--quiet",
  "-q",
  "--no-color",
  "--no-interactive",
  "--no-secrets-in-output",
  "--sandbox",
  "--fields",
  "--cwd",
  "--env-file",
  "--profile",
  "--output-file",
] as const;

export const cliManifest = {
  package: "wrangler-deploy",
  version: 1,
  resourceCapabilities: {
    adopt: {
      supportedResourceTypes: adoptSupportedResourceTypes(),
      unsupportedBehavior: "error",
    },
  },
  machineReadableDefaults: {
    json: true,
    dryRun: true,
    fields: true,
    ndjson: true,
    noColor: true,
    noInteractive: true,
    noSecretsInOutput: true,
    sandbox: true,
    outputFile: true,
  },
  globalFlags: GLOBAL_FLAGS,
  agentEnvVars: [
    { name: "AGENT_SANDBOX", description: "When set to 1, mutating commands without --dry-run are refused." },
    { name: "WD_NO_INTERACTIVE", description: "When set to 1, prompts are disabled (non-TTY mode)." },
    { name: "WD_NO_SECRETS", description: "When set to 1, secret-shaped values are stripped from output." },
    { name: "NO_COLOR", description: "Standard disable-color signal; honoured by wrangler-deploy." },
    { name: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token for authentication." },
    { name: "CLOUDFLARE_ACCOUNT_ID", description: "Cloudflare account ID (32-char hex)." },
    { name: "WD_STAGE", description: "Default stage when --stage is omitted." },
    { name: "WD_PROFILE", description: "Default profile when --profile is omitted." },
    { name: "WD_STATE_PASSWORD", description: "Password for encrypted state." },
  ],
  errorEnvelope: {
    description: "Shape returned in JSON mode when a command fails.",
    example: {
      ok: false,
      command: "wd deploy",
      error: {
        type: "auth",
        code: "WD_E_ACCOUNT_MISMATCH",
        message: "Cloudflare API error 10000: account mismatch",
        retryable: false,
        fix: "Set CLOUDFLARE_ACCOUNT_ID to match the account that owns your CLOUDFLARE_API_TOKEN.",
        suggestions: ["Run `wd doctor` to verify auth."],
      },
    },
    errorTypes: ["auth", "validation", "network", "config", "state", "not_found", "permission", "sandbox", "unknown"],
    errorCodes: [
      "WD_E_STATE_MISSING",
      "WD_E_RENDERED_CONFIG_STALE",
      "WD_E_ACCOUNT_MISMATCH",
      "WD_E_AUTH_FAILED",
      "WD_E_CONFIG_MISSING",
      "WD_E_NOT_FOUND",
      "WD_E_NETWORK",
      "WD_E_VALIDATION",
      "WD_E_PERMISSION",
      "WD_E_SANDBOX_BLOCKED",
      "WD_E_UNKNOWN",
    ],
  },
  commands: [
    { name: "create", description: "Scaffold a new starter project.", subcommands: ["vite"], flags: ["--json", "--dir", "--name", "--force", "--dry-run"], mutating: true, writesFiles: true, supportsDryRun: true, output: "text" },
    { name: "init", description: "Generate wrangler-deploy.config.ts from local Wrangler configs.", flags: ["--json", "--preset", "--account", "--force", "--dry-run"], mutating: true, writesFiles: true, supportsDryRun: true, output: "text" },
    { name: "introspect", description: "Generate wrangler-deploy.config.ts from live Cloudflare resources.", flags: ["--dry-run", "--json"], mutating: true, writesFiles: true, network: true, requiresAuth: true, supportsDryRun: true, output: "json" },
    { name: "plan", description: "Show resources that would be created, updated, or orphaned.", flags: ["--json", "--only", "--only-resources", "--explain", "--cost-hint", "--output-file"], requiresStage: true, output: "json" },
    { name: "apply", description: "Provision resources and render worker configs for a stage.", flags: ["--dry-run", "--json", "--only", "--only-resources", "--interactive", "--output-file"], mutating: true, writesFiles: true, network: true, requiresAuth: true, requiresStage: true, supportsDryRun: true, output: "json" },
    { name: "deploy", description: "Deploy rendered workers in dependency order.", flags: ["--dry-run", "--json", "--verify", "--plan-only", "--open", "--dashboard", "--print-url", "--copy", "--latest", "--no-open", "--only", "--changed", "--canary", "--lock", "--output-file"], mutating: true, network: true, requiresAuth: true, requiresStage: true, supportsDryRun: true, output: "json" },
    { name: "up", description: "Apply then deploy a stage in one shot (orchestrator over apply + deploy).", flags: ["--dry-run", "--json", "--verify", "--only", "--only-resources", "--force", "--database-url", "--output-file"], mutating: true, writesFiles: true, network: true, requiresAuth: true, requiresStage: true, supportsDryRun: true, output: "json" },
    { name: "tail", description: "Stream wrangler logs for one or all workers in a stage.", flags: ["--worker", "--format", "--status", "--sampling-rate", "--json"], network: true, requiresAuth: true, requiresStage: true, output: "text" },
    { name: "rollback", description: "Roll back worker to a prior version.", subcommands: ["list"], flags: ["--stage", "--worker", "--version", "--latest", "--verify", "--dry-run", "--json"], mutating: true, network: true, requiresAuth: true, requiresStage: true, supportsDryRun: true, output: "json" },
    { name: "destroy", description: "Tear down a stage.", flags: ["--dry-run", "--json", "--force", "--interactive"], mutating: true, network: true, requiresAuth: true, requiresStage: true, supportsDryRun: true, output: "json" },
    { name: "gc", description: "Destroy expired protected-by-TTL stages.", flags: ["--json", "--dry-run"], mutating: true, network: true, requiresAuth: true, supportsDryRun: true, output: "json" },
    { name: "status", description: "Inspect one stage or list available stages.", flags: ["--json", "--output", "--watch", "--interval-ms", "--web", "--diff", "--summary", "--fail-on-drift", "--output-file"], requiresStage: true, output: "json" },
    { name: "check", description: "Run combined doctor and plan preflight checks.", flags: ["--json", "--pack", "--output-file"], requiresStage: true, output: "json" },
    { name: "verify", description: "Run remote or local verification checks.", flags: ["--json", "--json-report", "--output-file", "--probe-urls", "--probe-timeout-ms"], requiresStage: true, network: true, output: "json" },
    { name: "graph", description: "Render the resource/workers topology.", flags: ["--format json", "--output-file"], output: "graph" },
    { name: "impact", description: "Explain the dependency impact of a worker.", flags: ["--json"], output: "json" },
    { name: "diff", description: "Compare two stages.", flags: ["--format json"], output: "json" },
    { name: "doctor", description: "Validate wrangler and repo prerequisites.", flags: ["--json", "--codes", "--fix", "--fix-dry-run", "--strict", "--auth"], supportsDryRun: true, output: "json" },
    { name: "open", description: "Resolve and open a deployed worker URL.", flags: ["--stage", "--worker", "--latest", "--copy", "--print-url", "--no-open", "--json"], requiresStage: true, output: "json" },
    { name: "dashboard", description: "Resolve and open a worker dashboard URL.", flags: ["--stage", "--worker", "--latest", "--copy", "--print-url", "--no-open", "--json"], requiresStage: true, output: "json" },
    { name: "explain", description: "Explain common error codes/messages and remediation.", flags: ["--json", "--from-last-error", "--error-code"], output: "json" },
    { name: "examples", description: "Print copy-pasteable examples for a command.", flags: ["--json", "--command"], output: "json" },
    { name: "sandbox", description: "Detect available OS sandbox or run a command inside one (sandbox-exec on macOS, bwrap on Linux). On macOS the proxy is the only egress (kernel-enforced). On Linux pass --strict-network for `--unshare-net` (no network at all). Use --allow-host to extend the allowlist or --no-network-filter to disable.", subcommands: ["info", "run"], flags: ["--json", "--allow-host", "--no-network-filter", "--strict-network"], output: "json" },
    { name: "schema", description: "Print the CLI manifest, output schemas, config schema, error schema, or examples schema.", subcommands: ["outputs", "config", "errors", "examples"], flags: ["--json", "--versioned", "--command"], output: "json" },
    { name: "context", description: "Show or update resolved project defaults.", subcommands: ["get", "set", "unset", "clear", "doctor", "export", "import"], flags: ["--json", "--file"], mutating: true, writesFiles: true, output: "json" },
    { name: "macro", description: "Save/list/run CLI command macros.", subcommands: ["list", "save", "run", "validate"], flags: ["--json", "--dry-run"], mutating: true, writesFiles: true, supportsDryRun: true, output: "json" },
    { name: "history", description: "Show deployment and rollback history for a stage.", flags: ["--stage", "--worker", "--json"], requiresStage: true, output: "json" },
    { name: "env", description: "Compare local and rendered worker environment configs.", subcommands: ["diff"], flags: ["--stage", "--worker", "--json"], requiresStage: true, output: "json" },
    { name: "lock", description: "Manage per-stage deploy locks.", subcommands: ["status", "acquire", "release"], flags: ["--stage", "--json"], mutating: true, writesFiles: true, requiresStage: true, output: "json" },
    { name: "replay", description: "Replay captured HTTP requests against a local worker.", flags: ["--file", "--worker", "--json"], output: "json" },
    { name: "route", description: "Verify and preview route configuration.", subcommands: ["verify", "apply"], flags: ["--json", "--zone-id"], requiresAuth: true, network: true, output: "json" },
    { name: "onboard", description: "Print first-run setup sequence for new developers.", flags: ["--stage", "--json"], output: "json" },
    { name: "tools", description: "Print tool metadata derived from the command manifest.", flags: ["--json"], output: "json" },
    { name: "secrets", description: "Check, set, and sync secrets for a stage.", subcommands: ["set", "sync"], flags: ["--dry-run", "--json"], mutating: true, network: true, requiresAuth: true, requiresStage: true, supportsDryRun: true, output: "json" },
    { name: "snapshot", description: "List, save, and load local runtime snapshots.", subcommands: ["list", "save", "load"], flags: ["--json"], mutating: true, writesFiles: true, output: "json" },
    { name: "fixture", description: "List shared fixtures.", subcommands: ["list"], flags: ["--json"], output: "json" },
    { name: "worker", description: "Inspect or call a worker.", subcommands: ["call", "routes"], flags: ["--json"], output: "json" },
    { name: "d1", description: "List, inspect, and execute D1 workflows (local + remote passthrough).", subcommands: ["list", "inspect", "exec", "execute", "seed", "reset", "migrate", "migrations"], flags: ["--json", "--dry-run", "--remote", "--command", "--file", "--worker"], mutating: true, writesFiles: true, supportsDryRun: true, output: "json" },
    { name: "queue", description: "Inspect, send, replay, and tail queue workflows.", subcommands: ["list", "inspect", "send", "replay", "tail"], flags: ["--json"], network: true, output: "json" },
    { name: "ci", description: "Generate CI workflow, comments, and checks.", subcommands: ["init", "comment", "check"], flags: ["--json", "--dry-run", "--force"], mutating: true, writesFiles: true, supportsDryRun: true, output: "json" },
    { name: "completions", description: "Generate shell completions.", flags: ["--shell"], output: "text" },
    { name: "configure", description: "Set up or update an auth profile (api-token or oauth).", flags: ["--method", "--account-id", "--json", "--profile"], mutating: true, writesFiles: true, output: "json" },
    { name: "login", description: "Save a Cloudflare API token (interactive or env).", flags: ["--json", "--profile"], mutating: true, writesFiles: true, output: "json" },
    { name: "logout", description: "Remove saved Cloudflare credentials for a profile.", flags: ["--json", "--profile"], mutating: true, writesFiles: true, output: "json" },
    { name: "auth", description: "Show effective auth/account sources, validate account access, and manage account defaults.", subcommands: ["status", "check", "switch", "doctor", "pin"], flags: ["--json", "--profile", "--account-id", "--stage"], network: true, output: "json" },
    { name: "profile", description: "List or remove configured profiles.", subcommands: ["list", "remove", "test"], flags: ["--json", "--profile"], output: "json" },
    { name: "bootstrap", description: "Safe onboarding flow: configure/login/context defaults/doctor.", flags: ["--json", "--profile", "--stage", "--account-id", "--dry-run"], output: "json" },
    { name: "quickstart", description: "Print a guided first-run workflow.", flags: ["--json", "--stage"], output: "json" },
    { name: "release-note", description: "Summarize stage changes since last marked success.", flags: ["--stage", "--mark-success", "--json"], requiresStage: true, output: "json" },
    { name: "telemetry", description: "Toggle local command telemetry.", subcommands: ["on", "off", "status"], flags: ["--json"], mutating: true, writesFiles: true, output: "json" },
    { name: "version", description: "Print the installed wrangler-deploy version.", flags: ["--json"], output: "json" },
    { name: "upgrade-check", description: "Check installed version against latest published version.", flags: ["--json"], network: true, output: "json" },
    { name: "preflight", description: "Run auth and dry-run safety checks before mutating commands.", flags: ["--json", "--stage", "--fix", "--dry-run"], output: "json" },
    { name: "dev", description: "Start local dev servers with auto port resolution. Long-running. With --json/--ndjson, emits one event per line (see `wd schema outputs --command devEvent`).", subcommands: ["doctor", "ui", "explain"], flags: ["--filter", "--session", "--mode", "--tunnel", "--base-port", "--fallback-stage", "--persist-to", "--port", "--json", "--ndjson"], network: true, output: "json" },
    { name: "logs", description: "Tail or read persisted dev logs for a worker.", flags: ["--since", "--tail", "--grep", "--grep-json", "--json", "--ndjson", "--once", "--every", "--output-file"], output: "json" },
    { name: "guard", description: "Provision and manage the workers-usage-guard worker.", subcommands: ["init", "deploy", "migrate", "status", "breaches", "report", "disarm", "arm", "approvals", "approve", "reject"], flags: ["--account", "--limit", "--date", "--reason", "--dir", "--billing-cycle-day", "--dry-run", "--skip-d1", "--force", "--json", "--workers", "--yes"], mutating: true, network: true, requiresAuth: true, supportsDryRun: true, output: "json" },
    { name: "state", description: "Inspect persisted stage state (list/get/tree).", subcommands: ["list", "get", "tree"], flags: ["--json", "--output-file"], requiresStage: true, output: "json" },
    { name: "output", description: "Print the state output (resources + workers) for a stage.", flags: ["--json", "--output-file"], requiresStage: true, output: "json" },
    { name: "run", description: "Validate config and print read-only stage summary.", flags: ["--json", "--output-file"], output: "json" },
    { name: "rotate-password", description: "Re-encrypt persisted state with a new state password.", flags: ["--old-password", "--new-password", "--json"], mutating: true, writesFiles: true, output: "json" },
    { name: "cron", description: "Trigger or loop a worker's scheduled handler locally.", subcommands: ["trigger", "loop"], flags: ["--port", "--cron", "--time", "--path", "--every", "--json"], network: true, output: "json" },
    { name: "util", description: "Misc utilities (e.g., create-cf-token instructions).", subcommands: ["create-cf-token"], flags: ["--json", "--profile"], output: "json" },
    { name: "help", description: "Show CLI usage or emit the manifest.", flags: ["--json"], output: "json" },
  ] satisfies CliCommandManifest[],
} as const;

export type CliManifest = typeof cliManifest;
