# wrangler-deploy example

A 3-worker Cloudflare application demonstrating wrangler-deploy's environment orchestration.

All resources are fully managed by Cloudflare. No external database, no Docker, no connection strings.

## Quick start

```bash
pnpm dev                         # start all 3 workers (auto port resolution)
```

After startup you'll see:
```
  ─── dev workers ───
  workers/api           http://127.0.0.1:8787
  workers/batch-workflow http://127.0.0.1:8788
  workers/event-router  http://127.0.0.1:8789
  3 worker(s) running. Press Ctrl+C to stop.
```

No `--stage` needed for `wd dev`. D1 runs locally via Miniflare.

## Stage management

```bash
pnpm plan                # see what would be created
pnpm apply               # provision D1, KV, Queues
pnpm deploy              # deploy all 3 workers
pnpm deploy -- --changed # deploy only git-changed workers
pnpm deploy -- --only workers/api   # deploy one worker
pnpm status              # check deployed URLs and versions
pnpm status -- --summary # one-line summary
pnpm status -- --watch --diff --interval-ms 3000
pnpm open                # open worker URL in browser
pnpm open -- --latest    # use last deployed worker without prompt
pnpm open -- --copy      # copy URL to clipboard
pnpm dashboard           # open Cloudflare dashboard
pnpm dashboard -- --print-url
pnpm destroy             # tear down
pnpm destroy -- --interactive
```

Stage defaults to `staging` (persisted in `.wdrc`). No `--stage` needed
for core commands after initial setup.

## Short aliases

```bash
wd d --stage dev          # deploy
wd a --stage dev          # apply
wd p --stage dev          # plan
wd s                      # status
```

## Agent-friendly output

```bash
wd deploy --json          # machine-readable JSON
wd plan --json            # plan as structured data
wd status --json          # full stage state as JSON
wd schema --json          # CLI manifest for tool discovery
wd schema --versioned     # versioned schema envelope for automation
wd schema outputs         # output payload schemas
wd schema outputs --command open
```

All errors emit structured JSON with suggestions when `--json` is passed.
The `.env` file is auto-loaded from the project root.

## Ephemeral environments

```bash
wd apply --stage pr-123          # own D1, KV, Queues
wd d --stage pr-123               # deploy with alias
# ... test ...
wd destroy --stage pr-123         # all gone
wd gc                             # cleanup expired stages
```

## New workflows

```bash
# Preflight and troubleshooting
wd check --stage staging
wd explain "No state found"
wd explain --from-last-error

# Rollback
wd rollback --stage staging --worker workers/api --version <version-id>
wd rollback --stage staging --worker workers/api --version <version-id> --dry-run
wd rollback --stage staging --worker workers/api --latest --verify
wd deploy --stage staging --plan-only

# Scoped plan/apply
wd plan --stage staging --only-resources kv --only-resources d1 --cost-hint --explain
wd apply --stage staging --only-resources kv --interactive

# Logs
wd logs workers/api --since 10m --once
wd logs workers/api --json --since 15m --once
wd logs workers/api --json --tail 200 --grep-json level --once

# Profile and telemetry
wd profile test --profile default
wd telemetry on
wd telemetry status
wd telemetry off

# Command macros
wd macro save smoke "wd check --stage staging && wd verify --stage staging"
wd macro list
wd macro run smoke
wd macro run smoke --dry-run
wd macro validate

# Preset init + quickstart
wd init --preset monorepo   # also: minimal, infra-only
wd quickstart --stage dev
wd context export --json > context.json
wd context import --file context.json
wd release-note --stage staging --mark-success
```
