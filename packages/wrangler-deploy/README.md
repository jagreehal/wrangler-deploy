# wrangler-deploy

Cloudflare Workers projects that use D1, KV, Queues, Hyperdrive, or R2 still leave a lot of repo-level wiring to the user. Wrangler and `wrangler.jsonc` are still the right foundation. The gap is that raw Wrangler does not give you a good way to treat a multi-worker app as one stageable system or one local runtime workflow.

wrangler-deploy sits on top of Wrangler. It reads your existing `wrangler.jsonc` files, provisions the resources for a named stage, wires up the IDs, deploys workers in dependency order, and tears everything down when you're done. It also gives you repo-aware local workflows so developers can say "send to `payment-outbox`" or "trigger `workers/batch-workflow`" instead of remembering which worker, which port, and which local route to hit.

It does not ask you to migrate away from `wrangler.jsonc`. It exists because teams like `wrangler.jsonc` and want to keep it.

```bash
wd apply   --stage pr-42          # creates D1, KV, Queues, etc.
wd deploy  --stage pr-42 --verify # deploys workers with real IDs
wd destroy --stage pr-42          # tears down everything
```

Spin up a full environment per PR, per branch, or per developer. Tear it down when you're done. Keep `wrangler dev` if you want, or use `wd dev`, `wd dev doctor`, `wd cron trigger`, and `wd queue send` when the repo is large enough that local conventions start drifting.

## Install

```bash
npm install -D wrangler-deploy
```

Then in any project with a `wrangler.jsonc`:

```bash
wd create vite my-app   # scaffold a new Vite starter
wd init    # scans your wrangler configs, generates wrangler-deploy.config.ts
wd plan --stage staging   # shows what would be created
wd apply --stage staging  # creates the resources
wd deploy --stage staging # deploys workers
```

Your `wrangler.jsonc` files stay untouched. `wrangler dev` still works. `wd dev` can either start one process per worker or a single shared Queue-oriented Wrangler session with `--persist-to`, while `wd` runtime commands resolve workers, ports, queue producers, and helper routes from one repo config.

If you already like `wrangler.jsonc`, that is the point. Keep it. wrangler-deploy is additive.

## Why use it if Wrangler already exists?

Because the gap is usually not "can Wrangler do this primitive action?" The gap is "does every developer on this repo know which worker, which port, which route, and which dependency order applies right now?"

Wrangler gives you:
- per-worker deploy and local dev commands
- local Queue and cron primitives
- the underlying Cloudflare auth and API surface

wrangler-deploy adds:
- stage-aware provisioning and teardown for the whole app
- deploy ordering derived from service bindings
- one config that maps logical names to workers, ports, queue producers, and local helper routes
- repo-aware local workflows like `wd dev doctor`, `wd dev ui`, `wd logs`, `wd worker routes`, `wd worker call`, `wd d1 exec`, `wd cron trigger`, `wd queue send`, `wd queue replay`, and `wd queue tail`

The product boundary is simple: Wrangler remains the engine. wrangler-deploy turns that engine into repeatable workflows for a multi-worker repo.

Another way to say it: if you love `wrangler.jsonc`, you should not have to give it up just to get staged resources, ordered deploys, and saner local workflows.

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
wd create vite <directory>               # scaffold a new Vite starter
wd init                                    # scan wrangler configs
wd plan     --stage <name>                 # dry-run
wd apply    --stage <name>                 # provision resources
wd deploy   --stage <name> [--verify]      # deploy workers
wd destroy  --stage <name> [--force]       # tear down
wd status   [--stage <name>]               # list stages or inspect one
wd verify   --stage <name>                 # post-deploy coherence check
wd verify   local                          # config-driven local smoke test
wd dev      [--session] [--persist-to ...] # local multi-worker dev
wd secrets  --stage <name>                 # check/set/sync secrets
wd gc                                      # destroy expired stages
```

Local runtime workflows are first-class too:

```bash
wd dev --session --persist-to .wrangler/state
wd dev doctor
wd dev ui --port 8899
wd fixture list
wd snapshot save local-baseline
wd snapshot load local-baseline
wd logs workers/api --once
wd worker routes workers/api
wd worker call workers/api --path /health
wd worker call --fixture echo-ping
wd d1 exec payments-db --sql 'SELECT COUNT(*) FROM batches;'
wd d1 exec --fixture payments-batch-count
wd cron trigger workers/batch-workflow
wd queue send payment-outbox --json '{"type":"batch.dispatched"}'
wd queue send --fixture payment-outbox-dispatch
wd queue replay payment-outbox --file fixtures/payment-outbox.json
wd queue tail payment-outbox
wd verify local --pack smoke
```

## Guard commands

`wd guard status` works against Cloudflare GraphQL directly — no deployed guard required.

```bash
CLOUDFLARE_API_TOKEN=... wd guard status
CLOUDFLARE_API_TOKEN=... wd guard status --json
```

`guard.accounts` has the same shape as the `workers-usage-guard` package's `ACCOUNTS_JSON` — see its README for the schema. Per-worker `forecast: true` opts into early-trigger projection; see the workers-usage-guard README.

### With a deployed guard

If you've deployed `workers-usage-guard` and added `guard.endpoint` + a signing-key env var (`WRANGLER_DEPLOY_GUARD_SIGNING_KEY`), you also get:

```bash
# Scaffold a guard worker package in your repo
wd guard init --account <account-id> [--dir packages/workers-usage-guard] [--billing-cycle-day 1] [--skip-d1] [--dry-run] [--force]

# Recent breaches for one account
wd guard breaches --account <account-id>
wd guard breaches --account <account-id> --limit 5 --json

# Latest usage report — or the one from a given day
wd guard report --account <account-id>
wd guard report --account <account-id> --date 2026-04-15
wd guard report --account <account-id> --json
```

`wd guard status` also overlays the 5 most recent breaches per account when a guard client is configured — visible in `--json` output.

```bash
# Runtime protection — toggle kill-switch immunity for a worker without redeploying the guard
wd guard disarm <script> --account <account-id>
wd guard disarm <script> --account <account-id> --reason "on-call escalation"
wd guard arm <script> --account <account-id>

# Human approval queue
wd guard approvals --account <account-id>
wd guard approve <approval-id> --account <account-id>
wd guard reject <approval-id> --account <account-id>
```

`disarm` inserts a runtime override into the guard's D1. `arm` removes it. Both go through the signed write endpoint; same signing key as the other commands.

### Dev UI panel

The dev UI (started with `wd dev`) now exposes a Workers Usage Guard panel at `/guard`. It always shows live usage from Cloudflare GraphQL, and overlays breaches + latest daily report + runtime-protected scripts when `guard.endpoint` and `WRANGLER_DEPLOY_GUARD_SIGNING_KEY` are set.

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
