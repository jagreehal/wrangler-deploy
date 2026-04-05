---
name: wrangler-deploy
description: Use when helping someone configure, use, or troubleshoot wrangler-deploy for Cloudflare Workers environment orchestration. Triggers on wrangler-deploy.config.ts, wd commands, staging environments, resource provisioning for Workers.
---

# wrangler-deploy

Environment orchestration for Cloudflare Workers. Reads existing `wrangler.jsonc` files, provisions resources per stage, deploys workers with real IDs, tears down cleanly.

## Commands

```
wd init                           # scan wrangler configs, generate wrangler-deploy.config.ts
wd plan     --stage <name>        # dry-run: what would change
wd apply    --stage <name>        # provision resources
wd deploy   --stage <name>        # deploy workers (--verify for health checks)
wd destroy  --stage <name>        # tear down (--force for protected stages)
wd status   [--stage <name>]      # inspect resources and drift
wd verify   --stage <name>        # post-deploy coherence check
wd secrets  --stage <name>        # check/set/sync secrets
wd gc                             # destroy expired unprotected stages
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

## Key behaviors

- `wrangler.jsonc` files stay untouched. Placeholder IDs work for `wrangler dev`.
- `wd apply` writes state after each resource (resumable on failure).
- `wd deploy` blocks if declared secrets are missing.
- `wd destroy` removes queue consumers, then workers, then resources.
- Protected stages require `--force` to destroy. Unmatched stages default to protected.
- Deploy order inferred from service bindings. Cycles rejected.
- Hyperdrive needs `--database-url` on first apply.

## Auth

Local: `wrangler login`. CI: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars. Account ID auto-resolved from `wrangler whoami` when not set.

## Single worker

Use `"."` as the worker path when config is at the project root:

```ts
workers: ["."],
resources: { cache: { type: "kv", bindings: { ".": "CACHE" } } },
```
