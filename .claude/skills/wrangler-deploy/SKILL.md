---
name: wrangler-deploy
description: Use when helping someone configure, use, or troubleshoot wrangler-deploy for Cloudflare Workers environment orchestration. Triggers on wrangler-deploy.config.ts, wd commands, staging environments, resource provisioning for Workers.
---

# wrangler-deploy

Environment orchestration for Cloudflare Workers. Reads existing `wrangler.jsonc` files, provisions resources per stage, deploys workers with real IDs, tears down cleanly.

## Commands

```
wd init                           # scan wrangler configs, generate wrangler-deploy.config.ts
wd introspect [--filter] [--dry-run]  # scan live account, generate config from existing resources
wd plan     --stage <name>        # dry-run: what would change
wd apply    --stage <name>        # provision resources
wd deploy   --stage <name>        # deploy workers (--verify for health checks)
wd destroy  --stage <name>        # tear down (--force for protected stages)
wd status   [--stage <name>]      # inspect resources and drift
wd verify   --stage <name>        # post-deploy coherence check
wd secrets  --stage <name>        # check/set/sync secrets
wd gc                             # destroy expired unprotected stages
wd graph    [--stage] [--format ascii|mermaid|dot|json]  # topology visualisation
wd impact   <worker-path>         # upstream/downstream dependency analysis
wd diff     <stage-a> <stage-b>   # compare two stages
wd dev      [--filter <worker>] [--port <base>]  # start local dev servers
wd ci init  [--provider github]   # generate GitHub Actions workflow
wd ci comment --stage <name>      # post/update PR comment with deploy status
wd ci check   --stage <name>      # post GitHub check run (exits 1 on failure)
wd doctor                         # diagnostic checks (wrangler, auth, config, workers)
wd completions --shell zsh|bash|fish  # generate shell completions
```

## Config structure

```ts
import { defineConfig, d1, kv, queue, hyperdrive, r2, worker, workerEnv } from "wrangler-deploy";

export default defineConfig({
  version: 1,
  workers: ["apps/api", "apps/worker"], // worker directories ("." for root)
  deployOrder: ["apps/worker", "apps/api"], // optional, inferred from serviceBindings
  resources: {
    "my-db": { type: "d1", bindings: { "apps/api": "DB" } },
    cache: { type: "kv", bindings: { "apps/api": "CACHE", "apps/worker": "CACHE" } },
    tasks: {
      type: "queue",
      bindings: { "apps/api": { producer: "TASKS" }, "apps/worker": { consumer: true } },
    },
    pg: { type: "hyperdrive", bindings: { "apps/api": "DB" } },
    uploads: { type: "r2", bindings: { "apps/api": "UPLOADS" } },
  },
  serviceBindings: { "apps/api": { BACKEND: "apps/worker" } },
  stages: {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
  secrets: { "apps/api": ["AUTH_SECRET", "API_KEY"] },
  routes: { "apps/api": { pattern: "api-{stage}.example.com/*", zone: "example.com" } },
  state: { backend: "kv", namespaceId: "xxx" }, // omit for local state
});
```

## Typed bindings (zero codegen)

```ts
// wrangler-deploy.config.ts
export const api = workerEnv({
  DB: d1("my-db"),
  CACHE: kv("cache"),
  QUEUE: queue<{ type: string }>("tasks"),
  PG: hyperdrive("pg"),
  BACKEND: worker("backend"),
});

// src/index.ts
import type { api } from "../wrangler-deploy.config.ts";
type Env = typeof api.Env;
// { DB: D1Database; CACHE: KVNamespace; QUEUE: Queue<{type: string}>; PG: Hyperdrive; BACKEND: Fetcher }
```

| Marker          | Runtime type  |
| --------------- | ------------- |
| `d1()`          | `D1Database`  |
| `kv()`          | `KVNamespace` |
| `queue<T>()`    | `Queue<T>`    |
| `hyperdrive()`  | `Hyperdrive`  |
| `r2()`          | `R2Bucket`    |
| `worker()`      | `Fetcher`     |
| `workflow<P>()` | `Workflow<P>` |
| `secret()`      | `string`      |

## Local dev

`wd dev` starts all workers with automatic port resolution — no port conflicts even with multiple workers or other local services. Wrangler's file watcher handles hot reload.

```bash
wd dev                        # start all workers
wd dev --filter workers/api   # start api + its service-binding deps only
wd dev --port 9000            # override base port
```

Unknown `--filter` values fail immediately with a clear error.

## CI integration

`wd ci init` generates a GitHub Actions workflow with:
- PR preview: apply + deploy + comment + check run
- Cleanup: destroy on PR close
- Production: apply + deploy on push to main
- Explicit permissions: `contents: read`, `issues: write`, `checks: write`

`wd ci check` posts a real GitHub check run and exits 1 on failure (not a silent success).

## Key behaviors

- `wrangler.jsonc` files stay untouched. Placeholder IDs work for `wrangler dev`.
- `wd apply` writes state after each resource (resumable on failure).
- `wd deploy` blocks if declared secrets are missing.
- `wd destroy` removes queue consumers, then workers, then resources.
- Protected stages require `--force` to destroy. Unmatched stages default to protected.
- Deploy order inferred from service bindings. Cycles rejected.
- Hyperdrive needs `--database-url` on first apply.
- `deadLetterFor` must reference another queue, not just any resource.
- Config validation catches unknown workers, DLQ targets, and service binding errors upfront.

## Auth

Local: `wrangler login`. CI: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars. Account ID auto-resolved from `wrangler whoami` when not set.

## Single worker

Use `"."` as the worker path when config is at the project root:

```ts
workers: ["."],
resources: { cache: { type: "kv", bindings: { ".": "CACHE" } } },
```
