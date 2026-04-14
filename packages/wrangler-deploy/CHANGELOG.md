# wrangler-deploy

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
