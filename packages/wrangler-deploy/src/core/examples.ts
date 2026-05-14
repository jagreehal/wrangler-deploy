export interface CommandExample {
  description: string;
  command: string;
  output?: string;
  notes?: string;
}

export interface CommandExampleSet {
  command: string;
  summary: string;
  examples: CommandExample[];
}

const EXAMPLES: Record<string, CommandExampleSet> = {
  configure: {
    command: "configure",
    summary: "Set up Cloudflare auth for this machine.",
    examples: [
      {
        description: "Interactive token-based setup.",
        command: "wd configure --method api-token --account-id <32-char-hex>",
      },
      {
        description: "Non-interactive setup using env vars (CI).",
        command: "CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... wd configure --method api-token --json",
      },
    ],
  },
  login: {
    command: "login",
    summary: "Save a Cloudflare API token under a profile.",
    examples: [
      {
        description: "Save a token to the default profile.",
        command: "wd login",
      },
      {
        description: "Save a token to a named profile in JSON mode (no prompts).",
        command: "wd login --profile work --json",
      },
    ],
  },
  init: {
    command: "init",
    summary: "Generate wrangler-deploy.config.ts from existing wrangler.jsonc files.",
    examples: [
      {
        description: "Scaffold a config in the current directory.",
        command: "wd init",
      },
      {
        description: "Preview what init would do without writing files.",
        command: "wd init --dry-run --json",
      },
      {
        description: "Use the monorepo preset.",
        command: "wd init --preset monorepo",
      },
    ],
  },
  plan: {
    command: "plan",
    summary: "Preview what apply would create, update, or remove.",
    examples: [
      {
        description: "Plan against staging.",
        command: "wd plan --stage staging --json",
      },
      {
        description: "Scope plan to one resource type.",
        command: "wd plan --stage staging --only-resources kv --cost-hint",
      },
      {
        description: "Persist the plan as an artifact.",
        command: "wd plan --stage staging --json --output-file .wrangler-deploy/plans/staging.json",
      },
    ],
  },
  apply: {
    command: "apply",
    summary: "Provision resources and render worker configs for a stage.",
    examples: [
      {
        description: "Apply against staging (must run before deploy).",
        command: "wd apply --stage staging --json",
      },
      {
        description: "Dry-run apply for review by an agent.",
        command: "wd apply --stage staging --dry-run --json",
      },
      {
        description: "Apply only certain resources.",
        command: "wd apply --stage staging --only-resources d1 --only-resources kv",
      },
    ],
  },
  deploy: {
    command: "deploy",
    summary: "Deploy rendered workers in dependency order. Requires a prior apply.",
    examples: [
      {
        description: "Deploy all workers to staging.",
        command: "wd deploy --stage staging --json",
      },
      {
        description: "Deploy only changed workers (git-aware).",
        command: "wd deploy --stage staging --changed --json",
      },
      {
        description: "Plan-only mode without performing the deploy.",
        command: "wd deploy --stage staging --plan-only --json",
      },
      {
        description: "Persist the deploy summary as an artifact.",
        command: "wd deploy --stage staging --json --output-file .wrangler-deploy/deploys/staging.json",
      },
    ],
  },
  rollback: {
    command: "rollback",
    summary: "Roll a worker back to a prior version.",
    examples: [
      {
        description: "List rollback candidates for a worker.",
        command: "wd rollback list --stage staging --worker workers/api --json",
      },
      {
        description: "Roll back to the latest known prior version.",
        command: "wd rollback --stage staging --worker workers/api --latest --verify --json",
      },
    ],
  },
  destroy: {
    command: "destroy",
    summary: "Tear down a stage. Protected stages require --force.",
    examples: [
      {
        description: "Destroy an ephemeral PR stage.",
        command: "wd destroy --stage pr-123 --json",
      },
      {
        description: "Dry-run destroy to inspect what would be removed.",
        command: "wd destroy --stage pr-123 --dry-run --json",
      },
    ],
  },
  status: {
    command: "status",
    summary: "Inspect deployed resources and worker URLs for a stage.",
    examples: [
      {
        description: "Status of a single stage.",
        command: "wd status --stage staging --json",
      },
      {
        description: "Watch mode with delta output.",
        command: "wd status --stage staging --watch --diff --interval-ms 3000",
      },
      {
        description: "Fail-on-drift, useful in CI.",
        command: "wd status --stage staging --fail-on-drift --json",
      },
    ],
  },
  doctor: {
    command: "doctor",
    summary: "Validate environment and project prerequisites.",
    examples: [
      {
        description: "Standard checks in JSON.",
        command: "wd doctor --json --codes",
      },
      {
        description: "Strict mode (warnings become failures).",
        command: "wd doctor --strict --json",
      },
      {
        description: "Auto-fix any fixable issues.",
        command: "wd doctor --fix --json",
      },
    ],
  },
  explain: {
    command: "explain",
    summary: "Explain a recent error or a known WD_E_* code.",
    examples: [
      {
        description: "Explain the most recent error captured by the CLI.",
        command: "wd explain --from-last-error --json",
      },
      {
        description: "Explain a specific stable code.",
        command: "wd explain --error-code WD_E_STATE_MISSING --json",
      },
    ],
  },
  schema: {
    command: "schema",
    summary: "Print the live CLI manifest or output schemas.",
    examples: [
      {
        description: "Full CLI manifest (commands, flags, metadata).",
        command: "wd schema --json",
      },
      {
        description: "Versioned schema envelope.",
        command: "wd schema --versioned --json",
      },
      {
        description: "Output schemas for all commands.",
        command: "wd schema outputs --json",
      },
      {
        description: "Output schema for a single command.",
        command: "wd schema outputs --command deploy --json",
      },
    ],
  },
  examples: {
    command: "examples",
    summary: "Print copy-pasteable examples for a command.",
    examples: [
      {
        description: "Show examples for `wd deploy`.",
        command: "wd examples --command deploy --json",
      },
      {
        description: "List every command that has examples.",
        command: "wd examples --json",
      },
    ],
  },
  secrets: {
    command: "secrets",
    summary: "Check, set, and sync secrets for a stage.",
    examples: [
      {
        description: "Check which secrets are missing for a stage.",
        command: "wd secrets --stage staging --json",
      },
      {
        description: "Sync secrets from .env.staging non-interactively.",
        command: "wd secrets sync --stage staging --json",
      },
      {
        description: "Dry-run sync to preview what would change.",
        command: "wd secrets sync --stage staging --dry-run --json",
      },
    ],
  },
  macro: {
    command: "macro",
    summary: "Save and run reusable command macros.",
    examples: [
      {
        description: "Save a smoke-test macro.",
        command: "wd macro save smoke 'wd check --stage staging && wd verify --stage staging'",
      },
      {
        description: "List saved macros.",
        command: "wd macro list --json",
      },
      {
        description: "Run a macro.",
        command: "wd macro run smoke",
      },
      {
        description: "Dry-run a macro to see what it would execute.",
        command: "wd macro run smoke --dry-run --json",
      },
    ],
  },
  ci: {
    command: "ci",
    summary: "Generate CI workflows and post status comments/checks.",
    examples: [
      {
        description: "Generate a GitHub Actions workflow.",
        command: "wd ci init --provider github --json",
      },
      {
        description: "Dry-run to preview the generated workflow.",
        command: "wd ci init --provider github --dry-run --json",
      },
      {
        description: "Post a PR comment summarising deploy status.",
        command: "wd ci comment --stage pr-123 --json",
      },
    ],
  },
  create: {
    command: "create",
    summary: "Scaffold a new starter project.",
    examples: [
      {
        description: "Scaffold a Vite starter into ./my-app.",
        command: "wd create vite --name my-app",
      },
      {
        description: "Preview scaffold without writing files.",
        command: "wd create vite --name my-app --dry-run --json",
      },
    ],
  },
  d1: {
    command: "d1",
    summary: "Local D1 database operations.",
    examples: [
      {
        description: "List local D1 databases.",
        command: "wd d1 list --json",
      },
      {
        description: "Run a query against a local D1 database.",
        command: "wd d1 exec my-db 'select 1' --json",
      },
      {
        description: "Dry-run reset to preview.",
        command: "wd d1 reset my-db --dry-run --json",
      },
    ],
  },
  version: {
    command: "version",
    summary: "Show the installed wrangler-deploy version.",
    examples: [
      {
        description: "Print version as JSON.",
        command: "wd version --json",
      },
    ],
  },
};

export function listExampleCommands(): string[] {
  return Object.keys(EXAMPLES).sort();
}

export function getExamples(command: string): CommandExampleSet | undefined {
  return EXAMPLES[command];
}

export function allExampleSets(): CommandExampleSet[] {
  return listExampleCommands().map((name) => EXAMPLES[name]!);
}
