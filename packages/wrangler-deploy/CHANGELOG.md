# wrangler-deploy

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
