# wrangler-deploy

Cloudflare Workers projects that use D1, KV, Queues, Hyperdrive, or R2 have no built-in way to spin up a complete environment. You create each resource by hand, copy IDs into config files, deploy workers one at a time, and reverse the whole process to tear down. For every stage. Every PR.

wrangler-deploy does this in one command. It reads your existing `wrangler.jsonc` files, provisions the resources for a named stage, wires up the IDs, deploys workers in dependency order, and tears everything down when you're done. It shells out to wrangler for every Cloudflare operation, so if `wrangler deploy` works on your machine, so does this.

```bash
wd apply   --stage pr-42          # creates D1, KV, Queues, etc.
wd deploy  --stage pr-42 --verify # deploys workers with real IDs
wd destroy --stage pr-42          # tears down everything
```

Spin up a full environment per PR, per branch, or per developer. Tear it down when you're done. Wire it into GitHub Actions and every pull request gets its own isolated Cloudflare stack.

## Install

```bash
npm install -D wrangler-deploy
```

Then in any project with a `wrangler.jsonc`:

```bash
wd init    # scans your wrangler configs, generates wrangler-deploy.config.ts
wd plan --stage staging   # shows what would be created
wd apply --stage staging  # creates the resources
wd deploy --stage staging # deploys workers
```

Your `wrangler.jsonc` files stay untouched. `wrangler dev` still works.

## What it manages

D1 databases, KV namespaces, Queues (producers, consumers, dead-letter), Hyperdrive connections, R2 buckets, Vectorize indexes, service bindings between workers, and secrets.

Each resource gets a stage-suffixed name (`cache-kv-staging`, `payments-db-pr-42`). Each worker gets a rendered `wrangler.jsonc` with real resource IDs injected.

## Typed bindings

Declare resources in config, get Worker `Env` types with no codegen:

```ts
// wrangler-deploy.config.ts
import { d1, kv, queue, workerEnv } from "wrangler-deploy";

export const api = workerEnv({
  DB: d1("database"),
  CACHE: kv("cache"),
  TASKS: queue<{ type: string }>("tasks"),
});
```

```ts
// src/index.ts
import type { api } from "../wrangler-deploy.config.ts";
type Env = typeof api.Env;
// { readonly DB: D1Database; readonly CACHE: KVNamespace; readonly TASKS: Queue<{ type: string }> }
```

Types resolve at compile time through TypeScript's conditional type system. Change a binding name and TypeScript catches every mismatch.

## CLI

Both `wrangler-deploy` and `wd` work after install.

```
wd init                                    # scan wrangler configs
wd plan     --stage <name>                 # dry-run
wd apply    --stage <name>                 # provision resources
wd deploy   --stage <name> [--verify]      # deploy workers
wd destroy  --stage <name> [--force]       # tear down
wd status   [--stage <name>]               # list stages or inspect one
wd verify   --stage <name>                 # post-deploy coherence check
wd secrets  --stage <name>                 # check/set/sync secrets
wd gc                                      # destroy expired stages
```

## Monorepos and single workers

Works at the root of a monorepo or inside a single worker directory:

```
# Monorepo                          # Single worker
apps/                               my-worker/
  api/wrangler.jsonc                   wrangler.jsonc
  worker/wrangler.jsonc                wrangler-deploy.config.ts
wrangler-deploy.config.ts
```

Deploy order is inferred from service bindings. Workers that are depended on deploy first.

## State

State is stored locally by default (`.wrangler-deploy/<stage>/state.json`). For teams and CI, store it in a shared KV namespace so anyone can apply, deploy, or destroy the same stage:

```ts
state: {
  backend: "kv",
  namespaceId: "your-kv-namespace-id",
}
```

## Stage protection and TTL

```ts
stages: {
  production: { protected: true },
  staging: { protected: true },
  "pr-*": { protected: false, ttl: "7d" },
}
```

Protected stages refuse `wd destroy` without `--force`. PR stages expire after their TTL, and `wd gc` cleans them up. Unmatched stages default to protected.

## Secrets

Declare required secrets per worker. `wd deploy` blocks if any are missing. Sync from `.dev.vars` files or set interactively.

## Auth

Uses wrangler's auth. Locally: `wrangler login`. In CI: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables.

## Docs

[Full documentation](https://jagreehal.github.io/wrangler-deploy/) with guides for PR previews, CI/CD, each resource type, and config reference.

## License

MIT
