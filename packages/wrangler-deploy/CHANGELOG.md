# wrangler-deploy

## 1.5.2

### Patch Changes

- ef44a1b: Improve starter scaffolding for frontend users.
  - Add a new `react` option to `wd create` that first attempts to scaffold via
    official `create-cloudflare` (React + Workers), then applies wrangler-deploy
    migration defaults.
  - Add a robust fallback path for `react` scaffolding that pulls
    `cloudflare/templates` `vite-react-template` if `create-cloudflare` fails or
    returns an unexpected project shape.
  - Apply wrangler-deploy migration to React scaffolds:
    `wrangler-deploy.config.ts`, `wd` scripts (`plan`, `apply`, `status`,
    `deploy:stage`), and `wrangler-deploy` dev dependency.
  - Normalize scaffolded React package name to the target directory name.
  - Fix the `vite` starter `dev` scripts to be package-manager agnostic by
    removing hardcoded `pnpm` subcommands.

## 1.5.1

### Patch Changes

- 664f280: Fix the `vite` starter scripts to be package-manager agnostic.

  Previously, the generated `dev` script hardcoded `pnpm` subcommands, which broke
  for users scaffolding with `npm` or `yarn`. The starter now runs `vite` and
  `wrangler` directly, and uses `wrangler dev --cwd workers/api --port 8787` for
  the worker command.

## 1.5.0

### Minor Changes

- 4bfcee8: Agent-native CLI: significant expansion of the surface for AI-driven workflows, plus
  ergonomic additions for humans.

  **New commands**
  - `check`, `rollback`, `macro`, `quickstart`, `telemetry`, `version`, `examples`,
    `tools`, `sandbox`, `configure`, `login`, `logout`, `profile`.

  **New global agent flags** (work on every command)
  - `--json` / `--ndjson` for machine output, plus `--fields a,b.c` projection.
  - `--no-color`, `--no-interactive`, `--no-secrets-in-output`, `--quiet`.
  - `--sandbox` (or `AGENT_SANDBOX=1`) for declarative refusal of mutating commands.
  - `--output-file <path>` for first-result artifact persistence on every JSON-emitting
    command (auto-redacted under `--no-secrets-in-output`).
  - `--input <path | ->` for reading JSON from a file or stdin (currently honoured by
    `plan`/`apply`/`deploy`).

  **Structured errors**
  - Every JSON failure returns `{ ok: false, command, error: { type, code, message,
retryable, fix, expected, suggestions } }`.
  - Stable `WD_E_*` codes with documented `error.type` enum.
  - Exit codes: `0` success, `1` runtime, `2` validation/sandbox refusal.
  - New `AgentErrors`/`assertStage`/`assertStageState`/`assertUsage` helpers for typed
    throws; ~200 internal throw sites migrated.
  - New error path for missing prerequisites: manifest-declared `requiresAuth`
    commands fail-fast with `WD_E_AUTH_FAILED` and `error.expected.env` listing the
    missing env vars.

  **Self-describing CLI**
  - `wd schema --json`, `wd schema outputs [--command <name>] --json`, `wd schema
config --json`, `wd schema errors --json`, `wd schema --versioned` for full
    introspection.
  - `wd tools --json` for compact tool metadata.
  - `wd examples [--command <name>] --json` for copy-pasteable per-command snippets.
  - `wd version --json` returns binary metadata (node, platform, sandbox flag,
    manifest version, timestamp).

  **Local dev event stream**
  - `wd dev --json` (or `--ndjson`) emits NDJSON lifecycle + per-worker log events
    (`dev.starting`, `worker.ready`, `dev.ready`, `worker.log`, `worker.error`,
    `dev.stopping`, `dev.stopped`). Human-formatted log output is redirected to
    stderr in event mode so stdout stays parseable.
  - Schema queryable via `wd schema outputs --command devEvent --json`.

  **Sandbox**
  - `wd sandbox info --json` detects the available OS sandbox (`sandbox-exec` on
    macOS, `bwrap` on Linux).
  - `wd sandbox run -- <cmd>` executes a command inside a real OS sandbox.
  - Outbound HTTP(S) is funneled through a local hostname-filtering proxy with a
    default Cloudflare/npm/GitHub allowlist; extend with `--allow-host <pattern>`
    (suffix-wildcard with leading dot) or disable with `--no-network-filter`.
  - macOS: kernel-blocks all outbound TCP except the proxy port — raw TCP and tools
    that bypass `HTTP_PROXY` fail with `Operation not permitted`.
  - Linux: pass `--strict-network` to use `--unshare-net` for full network isolation
    (no network at all). Default `bwrap` mode shares host network and only filters
    proxy-respecting traffic — documented honestly.

  **Existing-command improvements**
  - New troubleshooting path: `wd explain --from-last-error`.
  - Open/dashboard ergonomics: `--latest`, `--copy`, `--print-url`, `--no-open`.
  - Scoped iteration flags: `deploy --changed`, `deploy --only`, `apply/plan
--only-resources`.
  - Safety/operability flags: `apply/destroy --interactive`, `status --summary`,
    `status --diff`, `status --fail-on-drift`.
  - New profile diagnostic: `wd profile test`.
  - Context portability: `wd context export` / `wd context import`.
  - Release summaries: `wd release-note [--mark-success]`.
  - Macro hardening: `wd macro validate` and `wd macro run --dry-run`.
  - Rollback ergonomics: `wd rollback --latest --verify`.
  - Status/log output controls: `status --output`, `logs --tail`, `logs --grep-json`.
  - Doctor detail modes: `wd doctor --codes`, `wd doctor --fix-dry-run`.
  - `--dry-run` coverage extended to `init`, `create`, `ci init`, `macro save`,
    `snapshot save/load`.
  - Added opt-in local telemetry (`wd telemetry on|off|status`) with timing NDJSON
    output.

## 1.4.4

### Patch Changes

- 4616c05: Account resolution and rendered configs are safer and easier to reason about:
  - **Resolution order:** `CLOUDFLARE_ACCOUNT_ID`, then `.wdrc` / `.wdrc.json` `accountId`, then `wrangler whoami`, then OAuth `~/.wrangler/config/default.toml` only when **`CLOUDFLARE_API_TOKEN` is not set**. With a token set, `default.toml` is never read, avoiding Cloudflare API **error 10000** (token vs wrong account).
  - **Validation:** env and `.wdrc` account ids must be 32 hex characters (whitespace trimmed); invalid values fail with actionable errors.
  - **Rendered configs:** when the repo root is known, generated Wrangler configs include a pinned **`account_id`** aligned with `getWranglerEnv()`, with fallback to the base config’s `account_id` if resolution throws.
  - **Docs:** README Auth section expanded; Vitest mocks / env in tests avoid flaky `wrangler whoami` where rendering or dev plans resolve the account.

## 1.4.3

### Patch Changes

- 59f5890: Improve lifecycle safety and capability visibility for resource adoption.
  - Enforce `adopt` support by resource type and fail fast when unsupported.
  - Add `adopt` capability metadata to CLI schema output.
  - Persist and surface adopt lifecycle metadata in state output.
  - Keep `delete: false` behavior reliable when resources are removed from manifest.

## 1.4.2

### Patch Changes

- c4e11df: Remove workers-usage-guard-shared

## 1.4.0

### Minor Changes

- 98ca885: Add `wd guard` commands and `/guard` dev UI for Workers usage monitoring.

  A new `guard` config section lets you point `wrangler-deploy` at a deployed `workers-usage-guard` Worker. Once configured, the CLI gains five subcommands:
  - `wd guard status` — show current breach/armed state
  - `wd guard breaches` — list recent threshold breaches
  - `wd guard report` — fetch the latest daily usage report
  - `wd guard arm` — re-enable kill-switch protection after a disarm
  - `wd guard disarm` — temporarily disable kill-switch protection

  The dev UI (`wd dev`) now includes a `/guard` page that surfaces the same status and breach information in the browser.

  All requests to the guard Worker are signed with HMAC using the shared secret from the guard config, keeping the API private without requiring Cloudflare Access.

  Forecast mode (opt-in via `forecastMode: true` in the worker config) fires breach notifications when projected month-end usage is on track to exceed the threshold, not just when usage has already crossed it.

## 1.3.0

### Minor Changes

- dcb1c4d: Add agent-friendly CLI metadata, structured JSON output, `wd context` project defaults, richer machine-readable summaries for deploy and lifecycle commands, and a new `wd create vite` scaffold for greenfield Cloudflare Vite projects. Also document the new workflow in the docs site.

## 1.2.0

### Minor Changes

- 0a27eac: Add repo-aware local development workflows

  New local runtime commands that resolve workers, ports, queues, and routes from `wrangler-deploy.config.ts`:
  - `wd dev --session --persist-to` - shared Wrangler Queue session mode
  - `wd dev doctor` - preflight checks before dev startup
  - `wd dev ui` - local control plane for runtime workflows
  - `wd verify local` - config-driven local smoke tests with named packs
  - `wd snapshot save/load/list` - reproducible local state
  - `wd logs` - tail persisted worker logs
  - `wd worker call/routes` - resolve and call local workers by path
  - `wd d1 list/inspect/exec/seed/reset` - D1 workflows by logical name
  - `wd cron trigger/loop` - scheduled route testing
  - `wd queue list/inspect/send/replay/tail` - queue topology and local injection
  - `wd fixture list` - shared fixtures for worker calls, queue sends, D1 queries

  New configuration:
  - `verifyLocal.checks` - local verification harness
  - `verifyLocal.packs` - named smoke/regression packs
  - `fixtures` - reusable test payloads and SQL
  - `dev.session` - shared Miniflare state configuration
  - `dev.ports` - per-worker dev port preferences
  - `dev.queues` - local queue injection routes
  - `dev.endpoints` - named local HTTP endpoint shortcuts
  - `dev.d1` - D1 seed, reset, and default worker config
  - `dev.companions` - local-only helper processes
  - `dev.snapshots` - local state directories to snapshot

  The practical win is repo-awareness. Instead of remembering which worker owns a queue, which port it's on, or which local route to hit, you use logical names from one project config. Wrangler remains the engine. wrangler-deploy turns that engine into workflows for multi-worker repos.

## 1.1.0

### Minor Changes

- 61d49e0: ### Bug fixes
  - `wd ci check` now posts a real GitHub check run via `createCheckRun()` and exits 1 when no state is found, instead of logging success and doing nothing
  - `wd dev --filter` with an unknown worker name now throws immediately instead of entering an empty wait loop
  - `deadLetterFor` validation rejects references to non-queue resources (e.g. KV namespaces)
  - Generated GitHub Actions workflow now declares `permissions: issues: write, checks: write` so comment and check run steps work in repos with restricted defaults

  ### New features
  - Automatic port resolution in `wd dev` -- probes for free dev and inspector ports before spawning, so multi-worker setups work without conflicts
  - `wd dev` returns resolved ports in `handle.ports` for programmatic use
  - Extracted `postCheckRun()` as a testable module (`core/ci/check.ts`)
  - `findAvailablePorts()` utility for TCP port probing (`core/port-finder.ts`)

  ### Internal
  - Replaced all dynamic `await import()` calls with static imports (enforced by ESLint `no-restricted-syntax: ImportExpression`)
  - Phantom type system now imports real types from `@cloudflare/workers-types` instead of hand-rolled stubs
  - Renamed `apps/example/wrangler-stage.config.ts` to `wrangler-deploy.config.ts` to match CLI expectations
  - Added smoke test suite (`apps/smoke-test/`) covering startup, hot reload, multi-worker, and `--filter`
  - Added regression tests for all three bug fixes and workflow permissions
  - Added docs for dev mode, topology graph, impact analysis, stage diff, doctor, CI subcommands, and completions

## 1.0.2

### Patch Changes

- 1592656: Updated deps

## 1.0.1

### Patch Changes

- 03ae6c9: Deploy v1
