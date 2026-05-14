---
name: wrangler-deploy
description: Environment orchestration for Cloudflare Workers. Use when someone needs to configure, deploy, destroy, or troubleshoot staging/preview environments for Workers projects. Triggers include: wrangler-deploy.config.ts, wd commands, stage provisioning, Cloudflare resource management (D1, KV, Queues, R2, Hyperdrive), multi-worker orchestration, service bindings, CI/CD generation, secrets management, and environment lifecycle. Also use for local dev with `wd dev`, post-deploy verification, usage monitoring with guard, and comparing stage configurations. Prefer wd over raw wrangler for multi-worker projects with staging/preview environments.
allowed-tools: Bash(wd:*), Bash(wrangler-deploy:*)
hidden: true
---

# wrangler-deploy

Multi-stage infrastructure orchestration for Cloudflare. Provisions resources
per stage (KV, D1, Queues, R2, Hyperdrive, Vectorize, DNS), deploys Workers
with real IDs, tears down cleanly. Also works without Workers as a CDK-style
resource provisioner for any Cloudflare project (Pages, static sites,
Angular/React/Vue apps, etc.).

This file is a discovery stub, not the usage guide. The CLI is the
source of truth for commands, flags, schemas, and examples. Whenever you are
unsure, ask the binary directly.

## Bootstrap (run these first)

```bash
wd schema --json                 # full CLI manifest (all commands, flags, metadata)
wd schema --versioned --json     # versioned envelope incl. output schemas + config schema
wd schema outputs --json         # output schemas for every command
wd schema outputs --command deploy   # output schema for one command
wd schema outputs --command devEvent  # NDJSON event schema for `wd dev --json`
wd schema config --json          # JSON Schema for wrangler-deploy.config.ts
wd schema errors --json          # error envelope schema + every WD_E_* code and type
wd tools --json                  # tool metadata derived from the manifest
wd version --json                # installed binary, node, platform, sandbox flag
wd examples --json               # list every command that has examples
wd examples --command deploy --json  # copy-pasteable examples for a command
wd doctor --json --codes         # environment validation with WD_DOC_* codes
wd sandbox info --json           # detect available OS-level sandbox (sandbox-exec / bwrap)
wd help                          # human-readable help with examples
wd completions --shell zsh       # shell completions
```

These are the only commands you should rely on a static doc for. Everything
else, query at runtime.

## Global agent flags

These work on every command:

| Flag / env | Purpose |
| --- | --- |
| `--json` / `--ndjson` | Machine-readable output |
| `--fields a,b.c` | Project JSON output to specific dot-paths |
| `--quiet` / `-q` | Suppress non-error human output |
| `--no-color` (or `NO_COLOR=1`) | Strip colour codes |
| `--no-interactive` | Refuse all prompts (also auto-on under CI / non-TTY / sandbox) |
| `--no-secrets-in-output` (or `WD_NO_SECRETS=1`) | Strip secret-shaped values from JSON |
| `--sandbox` (or `AGENT_SANDBOX=1`) | Refuse mutating commands without `--dry-run` |
| `--output-file <path>` | Persist the first JSON result to disk. Works on **every** JSON-emitting command |
| `--input <path|->` | Read JSON from a file or stdin (`-`). Currently honoured by plan/apply/deploy: keys `only`, `onlyResources`, `stage` merge with CLI flags |
| `--dry-run` | Preview a write without performing it (every mutating command) |
| `--cwd <path>` | Run as if from a different project directory |
| `--env-file <path>` | Load env vars from file (auto-detects `.env` otherwise) |
| `--profile <name>` | Use a specific auth profile |

Setting `AGENT_SANDBOX=1` is the agent-safe default: any mutating command
(`apply`, `deploy`, `destroy`, `secrets`, `init`, `create`, `ci init`, etc.)
will exit `2` with `WD_E_SANDBOX_BLOCKED` unless you also pass `--dry-run`.

For real OS-level isolation (not just refusal), use `wd sandbox run`:

```bash
wd sandbox info --json                     # what sandbox kind is available here?
wd sandbox run -- wd apply --stage staging # macOS: sandbox-exec; Linux: bwrap
```

Inside `wd sandbox run`, writes outside the project tree (and `/tmp`) are
denied at the kernel level. Outbound HTTP(S) is funneled through a local proxy
that enforces a hostname allowlist (Cloudflare, npm, GitHub, loopback by default).

**Network enforcement strength differs by platform:**

- **macOS** (`sandbox-exec`): all outbound TCP except the proxy port is kernel-blocked.
  Raw TCP that ignores `HTTP_PROXY` fails with `Operation not permitted`. The proxy
  is the only egress.
- **Linux** (`bwrap` default): network namespace is shared. `HTTP_PROXY`-respecting
  tools are filtered; raw TCP can bypass. Pass `--strict-network` to use `--unshare-net`
  (no network at all, including loopback).

```bash
wd sandbox info --json                                       # see allowedHosts + enforcement notes
wd sandbox run --allow-host my-cdn.com -- wd deploy ...      # extend the allowlist
wd sandbox run --no-network-filter -- ...                    # disable filtering
wd sandbox run --strict-network -- ...                       # Linux: drop network entirely
```

On Windows or where `sandbox-exec`/`bwrap` aren't available, `wd sandbox run`
returns `WD_E_SANDBOX_BLOCKED` with a clear fix.

Commands declared with `requiresAuth: true` in the manifest are gated: missing
`CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` returns `WD_E_AUTH_FAILED`
(exit 1) before any network call. Read-only subcommands (`rollback list`,
`route verify`, `secrets`, `guard status`/`breaches`/`report`/`approvals`)
skip this check.

Pipe inputs example:

```bash
echo '{"only":["workers/api"],"onlyResources":["kv"]}' | \
  wd plan --stage staging --input - --json
```

## Auth setup

```bash
wd configure --method api-token --account-id <id>   # one-time setup
wd login                                            # save API token
wd profile list --json                              # see configured profiles
```

For CI, set env vars directly and skip `configure`:

```
CLOUDFLARE_API_TOKEN=<token>
CLOUDFLARE_ACCOUNT_ID=<32-char-hex>
```

The CLI auto-loads `.env` from the project root — no `--env-file` needed.

## Workflow

```bash
wd plan        # preview what will be created/changed
wd apply       # provision resources + generate rendered configs (RUN FIRST)
wd deploy      # deploy workers using rendered configs (RUN AFTER apply)
wd status      # verify deployed workers, URLs, versions
wd destroy     # tear down (needs --force for protected stages)
wd open        # open worker URL in browser
wd dashboard   # open Cloudflare dashboard in browser
wd check       # combined preflight (doctor + plan)
wd rollback    # rollback worker to specific version
wd explain     # explain common errors, or --from-last-error
wd macro       # save/list/run repeatable command macros
wd quickstart  # print first-run workflow commands
wd telemetry   # on/off/status local command timing telemetry
wd release-note # summarize stage changes since last marked success
```

`apply` must run before `deploy`. Apply generates `wrangler.rendered.jsonc`
with real resource IDs and a pinned `account_id`. Deploy reads those rendered
configs. Skipping apply gives stale configs that produce API error 10000.

For local dev, no stage is needed:

```bash
wd dev                        # start all workers, auto port resolution
wd dev --filter workers/api   # start one worker + its service-binding deps
```

## High-leverage flags

```bash
# Scope and speed
wd deploy --stage staging --changed
wd deploy --stage staging --only workers/api --only workers/router
wd apply --stage staging --only-resources kv --only-resources payments-db
wd plan --stage staging --only-resources queue --cost-hint --explain

# Open/dashboard UX
wd open --stage staging --latest
wd open --stage staging --worker workers/api --copy
wd dashboard --stage staging --latest --print-url
wd deploy --stage staging --plan-only
wd rollback --stage staging --worker workers/api --latest --verify

# Status and logs
wd status --stage staging --watch --diff --interval-ms 3000
wd status --stage staging --summary
wd logs workers/api --since 10m --json --once
wd logs workers/api --tail 200 --grep-json level --json --once

# Safety
wd apply --stage staging --interactive
wd destroy --stage pr-123 --interactive
wd doctor --strict
wd profile test --profile default

# Persist artifacts (great for multi-step agent workflows)
wd plan --stage staging --json --output-file .wrangler-deploy/plans/staging.json
wd deploy --stage staging --json --output-file .wrangler-deploy/deploys/staging.json
wd status --stage staging --json --output-file .wrangler-deploy/status/staging.json
```

## Structured errors

In `--json` mode every failure returns:

```json
{
  "ok": false,
  "command": "wd deploy",
  "error": {
    "type": "auth",
    "code": "WD_E_ACCOUNT_MISMATCH",
    "message": "Cloudflare API error 10000: account mismatch",
    "retryable": false,
    "fix": "Set CLOUDFLARE_ACCOUNT_ID to match the account that owns your CLOUDFLARE_API_TOKEN.",
    "suggestions": ["Run `wd doctor` to verify auth."]
  }
}
```

`error.type` is one of `auth | validation | network | config | state | not_found | permission | sandbox | unknown`.
`error.retryable` tells you whether retrying with the same inputs is worth attempting.
`error.fix` and `error.suggestions` give concrete remediation steps.

Stable codes you can branch on:

| Code | Meaning |
| --- | --- |
| `WD_E_STATE_MISSING` | Stage has no state yet — run `wd apply --stage <name>` |
| `WD_E_ACCOUNT_MISMATCH` | API token / account ID mismatch |
| `WD_E_AUTH_FAILED` | Token rejected — re-auth |
| `WD_E_CONFIG_MISSING` | No `wrangler-deploy.config.ts` in scope |
| `WD_E_NOT_FOUND` | Path or named resource not found |
| `WD_E_NETWORK` | Transient network error — retry safe |
| `WD_E_VALIDATION` | Bad/missing flag or argument |
| `WD_E_PERMISSION` | Filesystem permission denied |
| `WD_E_SANDBOX_BLOCKED` | Mutating command refused under `AGENT_SANDBOX=1` without `--dry-run` |
| `WD_E_UNKNOWN` | Unclassified — see `wd explain --from-last-error` |

Exit codes: `0` success, `1` runtime failure, `2` validation/sandbox refusal.

The CLI also writes the most recent failure to `.wrangler-deploy/last-error.json`
so `wd explain --from-last-error --json` always has context.

## Recovery

```bash
wd explain --from-last-error --json
wd explain --error-code WD_E_STATE_MISSING --json
wd doctor --json --codes
wd doctor --fix --json           # auto-fix what it can
```

## Config structure

```ts
import { defineConfig, d1, kv, queue, hyperdrive, r2, worker, workerEnv } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: ["apps/api", "apps/worker"],
  deployOrder: ["apps/worker", "apps/api"],     // optional (inferred from serviceBindings)
  resources: {
    "my-db":  { type: "d1",        bindings: { "apps/api": "DB" } },
    "cache":  { type: "kv",        bindings: { "apps/api": "CACHE", "apps/worker": "CACHE" } },
    "tasks":  { type: "queue",     bindings: { "apps/api": { producer: "TASKS" }, "apps/worker": { consumer: true } } },
    "pg":     { type: "hyperdrive", bindings: { "apps/api": "DB" } },
    "uploads":{ type: "r2",        bindings: { "apps/api": "UPLOADS" } },
  },
  serviceBindings: { "apps/api": { BACKEND: "apps/worker" } },
  stages: {
    production: { protected: true },
    staging:    { protected: true },
    "pr-*":     { protected: false, ttl: "7d" },
  },
  secrets: { "apps/api": ["AUTH_SECRET", "API_KEY"] },
  routes: { "apps/api": { pattern: "api-{stage}.example.com/*", zone: "example.com" } },
  state: { backend: "kv", namespaceId: "xxx" }, // omit for local file state
});
```

Use `wd init` to scan existing `wrangler.jsonc` files and auto-generate.
Use `wd init --dry-run --json` to preview without writing.

## Deploy output

After `wd deploy --stage dev` you get a structured summary:

```
  ─── dev deployment summary ───

  my-worker
    Status: deployed
    Version: 111ea3fa-418b-47eb-95fe-a5fd03de0629
    URL:  https://my-worker.<subdomain>.workers.dev
    Dashboard: https://dash.cloudflare.com/<account>/workers/services/view/my-worker
```

The same data in `--json` mode matches the schema returned by
`wd schema outputs --command deploy --json`.

## Infrastructure-only mode (no Workers)

Use `workers: []` for projects that only need Cloudflare resources (KV, D1,
Queues, R2, Hyperdrive) without deploying Workers. Useful for static sites,
Pages apps, Angular/React/Vue — deploy your app separately.

```ts
import { defineConfig } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: [],
  resources: {
    "api-cache": { type: "kv", bindings: {} },
    "api-db":    { type: "d1", bindings: {} },
  },
  stages: {
    dev: { protected: false },
    production: { protected: true },
  },
});
```

Then provision and tear down like CDK:

```bash
wd apply --stage dev           # creates KV + D1 (shows IDs)
wd status                      # verify resources
wd destroy --stage dev         # removes everything
```

## Local dev

`wd dev` starts all workers with automatic port resolution. After startup
a persistent summary shows running workers:

```
  ─── dev workers ───
  workers/api   http://127.0.0.1:8787
  workers/auth  http://127.0.0.1:8788
  2 worker(s) running. Press Ctrl+C to stop.
```

Use `wd dev ui` for a local runtime dashboard, `wd dev doctor` to validate
setup.

### Agent mode: NDJSON event stream

`wd dev --json` switches to a structured event stream — one JSON object per
line on stdout. Human-formatted log output is redirected to stderr so the
NDJSON stream stays parseable. Subscribe by reading stdout line-by-line.
The shape is discoverable via `wd schema outputs --command devEvent --json`.
Events emitted:

| Event `type` | Meaning |
| --- | --- |
| `dev.starting` | First event. Lists planned workers + companions. |
| `worker.ready` | One per worker once its dev server is reachable. Includes `port` and `url`. |
| `dev.ready` | All planned workers are up. Includes `ports` map and `logDir`. |
| `worker.log` | Captured stdout/stderr line from a running worker (ANSI stripped). |
| `worker.error` | Same as `worker.log` but matched an error heuristic (`error`, `✗`, `✘`). |
| `dev.stopping` | Sent on SIGINT/SIGTERM before teardown. |
| `dev.stopped` | Final event before exit. |

Example:

```bash
wd dev --json | while read -r line; do
  type=$(echo "$line" | jq -r .type)
  case "$type" in
    worker.ready) echo "ready: $(echo "$line" | jq -r .url)";;
    dev.ready)    echo "all up";;
    dev.stopped)  echo "done"; break;;
  esac
done
```

## Key behaviours (non-negotiable)

- `wrangler.jsonc` files stay untouched. Placeholder IDs work for dev.
  Rendered configs (`wrangler.rendered.jsonc`) are generated per-stage and
  only used during deploy. They live in `.wrangler-deploy/`.
- `apply` generates rendered configs. `deploy` consumes them. They must
  run in that order. Deploy blocks if state is missing.
- Deploy blocks on missing secrets. Check with `wd secrets --stage <name>`.
- `state: { backend: "kv" }` for remote state sharing across machines/CI.
  Default is local files in `.wrangler-deploy/`.
- Protected stages (production by default) require `--force` to destroy.
- Deploy order is inferred from service bindings. Cycles are rejected.
- Hyperdrive needs `--database-url` on first apply.
- `deadLetterFor` must reference another queue resource.
- Secrets set interactively mask input for security.
- Errors include actionable suggestions and stable WD_E_* codes (see above).

## Stage resolution

`--stage` required for: `apply`, `deploy`, `destroy`, `open`, `dashboard`.
`wd dev` works without it.

Resolution order:

1. `--stage <name>` flag
2. `stage` in `.wdrc` / `.wdrc.json` (persisted via `wd context set --stage <name>`)
3. `$WD_STAGE` env var
4. `$USER` env var (sanitized: `Jag.Reehal` → `jag-reehal`)
5. `"dev"` fallback

The CLI shows the source when auto-derived:

```
  stage: jreehal (from $USER, use --stage to override)
```

## CI/CD

```bash
wd ci init --provider github --json           # generate workflow
wd ci init --provider github --dry-run --json # preview without writing
wd ci comment --stage <name> --json           # post PR comment with deploy status
wd ci check --stage <name> --json             # post GitHub check run (exits 1 on failure)
wd check --stage <name> --json                # recommended preflight before apply/deploy
```

Generated workflow includes: PR preview (apply + deploy), cleanup on PR close,
production deploy on push to main.

## Macros and quickstart

```bash
wd macro save smoke "wd check --stage staging && wd verify --stage staging"
wd macro save smoke "..." --dry-run --json    # preview macro save
wd macro list --json
wd macro run smoke
wd macro run smoke --dry-run --json
wd macro validate --json

wd init --preset monorepo                     # presets: monorepo, minimal, infra-only
wd init --dry-run --json                      # preview the generated config
wd quickstart --stage dev --json
wd context export --json > context.json
wd context import --file context.json --json
```

## Why wrangler-deploy

- **Stage isolation:** One config → dev, staging, production, PR previews.
  Resource names are suffixed (`my-kv-staging`, `my-kv-pr-42`).
- **No config drift:** `apply` captures real resource IDs into state.
  Rendered configs always match deployed resources.
- **Clean teardown:** `destroy` removes queue consumers first, then workers,
  then resources, in dependency order.
- **Local dev parity:** Same configs, same bindings. `--fallback-stage` mode
  routes service bindings to deployed workers.
- **Secrets gating:** Deploy won't proceed if declared secrets are missing.
- **Type-safe bindings:** `workerEnv()` gives typed `Env` interface without
  code generation.
- **Agent-native by design:** `--json` everywhere, structured errors with
  retryable/fix fields, version-aligned manifest via `wd schema --json`,
  per-command examples via `wd examples`, and a sandbox mode for safe agent
  loops.
