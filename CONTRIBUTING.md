# Contributing to wrangler-deploy

## Prerequisites

- Node.js >= 20
- pnpm 10.x (`corepack enable && corepack prepare pnpm@10.15.1 --activate`)
- wrangler >= 4.80.0 (`npm i -g wrangler` or use the local dev dependency)

## Setup

```bash
pnpm install
```

## Build

```bash
# Build all packages (via turbo)
pnpm build

# Build just wrangler-deploy
cd packages/wrangler-deploy && pnpm build

# Watch mode
cd packages/wrangler-deploy && pnpm dev
```

## Quality checks

Run everything at once:

```bash
pnpm quality
```

Or individually:

```bash
pnpm typecheck     # tsc --noEmit across all packages
pnpm lint          # eslint (includes dynamic import ban)
pnpm test          # vitest unit tests (203 tests)
```

## Unit tests

```bash
# All unit tests
cd packages/wrangler-deploy && pnpm test

# Specific file
cd packages/wrangler-deploy && npx vitest run src/core/dev.test.ts

# Watch mode
cd packages/wrangler-deploy && npx vitest
```

## Smoke tests

The smoke tests in `apps/smoke-test/` start real wrangler dev servers and verify HTTP responses, hot reload, and `--filter` behavior. They require wrangler to be installed.

```bash
cd apps/smoke-test && pnpm test
```

What they cover:

| Test | What it verifies |
|------|-----------------|
| starts a worker | `wd dev` spawns wrangler, worker responds to HTTP |
| hot-reloads | file change triggers wrangler reload, new response returned |
| starts both workers | 2-worker config starts both on unique ports |
| --filter starts only filtered worker | only the target worker starts, other port stays closed |
| --filter throws for unknown worker | bad filter value fails fast with error |

The smoke tests use unique port ranges (8687+) to avoid conflicts with other local servers.

## Example app

The 3-worker example app lives in `apps/example/`. It demonstrates D1, KV, Queues, service bindings, and dead letter queues.

```bash
cd apps/example

# Start all workers in dev mode
pnpm dev

# Typecheck the example
npx tsc --noEmit
```

Ports are resolved automatically — `startDev()` probes for available ports before spawning, so you don't need to worry about conflicts with other local services.

## ESLint rules

The project enforces a ban on dynamic `import()` expressions (`no-restricted-syntax: ImportExpression`). All imports must be static `import` statements at the top of the file. The only exceptions are in `src/cli/index.ts` for loading user config files by computed path — these have `eslint-disable-next-line` comments.

## Project structure

```
packages/wrangler-deploy/   # Main package (CLI + library)
  src/cli/index.ts           # CLI entry point
  src/core/                  # Core logic (graph, dev, ci, validation)
  src/typed.ts               # Phantom type system for worker env derivation
apps/smoke-test/             # Integration smoke tests (real wrangler processes)
apps/example/                # 3-worker demo app
```
