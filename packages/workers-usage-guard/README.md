# workers-usage-guard

Control-plane Cloudflare Worker that monitors Workers usage (requests, CPU ms, estimated cost) across configured accounts and automatically detaches public entry points (zone routes, custom domains) when thresholds are crossed. Fans breach and daily-report events out to pluggable notification channels (Discord, Slack, generic webhooks).

## Install

```bash
npm install -g workers-usage-guard
# or one-shot, no install:
npx workers-usage-guard setup --account <id> --scripts api,worker --api-token <token> --yes
```

The package ships a CLI binary (`wug`, also available as `workers-usage-guard`) with everything needed to provision, deploy, and operate the guard.

## One-command install

```bash
wug setup
```

`wug setup` walks through:

1. Verifies wrangler is installed and authed.
2. Creates a D1 database (or reuses `--database-id`).
3. Generates a signing key (or reuses `$GUARD_API_SIGNING_KEY`).
4. Writes `wug.config.json` to the current directory — the only file you ever edit.
5. Applies D1 migrations.
6. Deploys the Worker.
7. Sets `CLOUDFLARE_API_TOKEN` and `GUARD_API_SIGNING_KEY` as Worker secrets.
8. Polls `/api/health` until the endpoint responds.
9. Prints the live endpoint URL and the signing key (save it).

For CI, pass `--yes` plus all required flags:

```bash
wug setup --yes \
  --account 1234abcd \
  --scripts payment-api,event-router \
  --api-token $CLOUDFLARE_API_TOKEN
```

## After setup

All operational commands read endpoint + signing key from `wug.config.json` (or `$WUG_ENDPOINT` / `$GUARD_API_SIGNING_KEY`):

```bash
wug breaches              # recent breach forensics
wug report                # latest daily usage report
wug snapshots --script payment-api --window 24h
wug disarm payment-api    # block kill-switch on a script
wug arm payment-api       # re-enable
wug approvals             # pending human approvals
wug approve appr-123
wug logs                  # tail wrangler logs
wug doctor                # check config + endpoint reachability
wug preflight             # check secrets are set on the Worker
wug safe-mode             # non-destructive risk preview + blockers
wug destroy               # delete the Worker (and its D1)
```

Run `wug --help` for the full surface, `wug <command> --help` for details. Every command supports `--json` for machine-readable output.

## Configuration

`wug.config.json` is the source of truth. Sample:

```json
{
  "endpoint": "https://workers-usage-guard.example.workers.dev",
  "databaseId": "bd0274ea-ea3b-4fd7-966d-ee55d6ce9947",
  "scriptName": "workers-usage-guard",
  "accounts": [
    {
      "accountId": "1234abcd",
      "billingCycleDay": 1,
      "workers": [
        {
          "scriptName": "payment-api",
          "thresholds": { "requests": 500000, "cpuMs": 5000000 }
        }
      ]
    }
  ],
  "notifications": {
    "channels": [
      { "type": "discord", "webhookUrlSecret": "DISCORD_WEBHOOK" }
    ]
  },
  "vars": {
    "requestThreshold": 500000,
    "cpuTimeThresholdMs": 5000000,
    "overageCooldownSeconds": 3600,
    "overageGraceSeconds": 14400
  }
}
```

The signing key is **never** stored here. Always pass it via `$GUARD_API_SIGNING_KEY` or `--signing-key`.

## Inspection helpers

```bash
wug secret-audit                                # list every secret your config requires
wug diff-config --before a.json --after b.json  # diff two ACCOUNTS_JSON snapshots
wug blast-radius                                # which scripts the kill-switch could affect
wug safe-mode                                   # one-shot safety simulation before changes
wug keygen                                      # generate a fresh signing key
wug sign --method GET --path /api/breaches?...  # raw signed headers for manual curl
```

## Working with `wrangler-deploy`

If you already use `wrangler-deploy`, the same Worker can be installed via `wd guard init` instead of `wug setup`. The two paths produce identical deployments — `wug` writes `wug.config.json`, `wd` writes `guard.*` into `wrangler-deploy.config.ts`.

## What this package ships

- Every 5 min: billing-period usage scan → detect breaches → spawn kill-switch Workflow per breach.
- Every day 08:00 UTC: usage rollup + dispatch.
- Kill switch: `protected-check → await-approval → capture-forensics → detach-routes → detach-custom-domains → disable-workers-dev → notify → log-activity → set-grace-period`.
- Signed HTTP read API: `/api/reports`, `/api/breaches`, `/api/snapshots`, plus unsigned `/api/health`.
- Signed write API: `/api/disarm`, `/api/approvals/:id/approve`, `/api/approvals/:id/reject`.
- Signed read API for operational controls: `/api/runtime-protected`, `/api/approvals`.
- D1-backed history and forensics for postmortem.
- Forecast-mode early trigger support and human approval gates.

## Operational notes

- `workers.dev` subdomain disable is now part of the automated kill path.
- Approval records are stored in `pending_approvals` (migration `0003_pending_approvals.sql`).
- `wrangler-deploy` integrates with this API for `wd guard status|breaches|report|disarm|arm|approvals|approve|reject`.

## Prerequisites

- A Cloudflare account, a dedicated D1 database for this Worker, and a Workers Standard plan.
- An API token scoped to: Workers Routes Write, Workers Scripts Read, Account Analytics Read, plus Workers Routes Write on every zone where the guarded Workers have routes.
- Workflows enabled on your account.

## Manual deploy (without `wug setup`)

`wug setup` does all of this for you. The manual flow is documented for reference if you want to wire deployment into existing CI:

1. `wrangler d1 create workers-usage-guard` → copy the `database_id` into `wug.config.json` (`databaseId` field).
2. Configure `accounts`, `notifications`, and `vars` in `wug.config.json`.
3. `wug migrate` — applies bundled D1 migrations against the configured database.
4. `wug deploy` — renders a wrangler config from your `wug.config.json` and deploys.
5. `wrangler secret put CLOUDFLARE_API_TOKEN` and `wrangler secret put GUARD_API_SIGNING_KEY`. Plus any notification-channel webhook secrets.
6. `wug doctor` to verify, `wug health` to confirm the endpoint is live.

## Safety notes

- The guard hard-codes `env.GUARD_SCRIPT_NAME` as protected — it cannot kill itself.
- Detaching public entry points does not stop internal traffic (Durable Objects, worker-to-worker `fetch()`, public R2 reads). The guard reports on these in the daily rollup but does not take action on them.
- All webhook URLs are validated at config-parse time and again at dispatch time (no RFC1918, no `localhost`, HTTPS only).
- Cooldown (default 1 h) and grace period (default 4 h) prevent repeat kills and post-action flapping.
- Activity log (`activity_log` table) records every destructive action and every suppression decision.

## Testing

```bash
pnpm test       # unit
pnpm test:int   # integration (miniflare)
```

Integration tests throw if `CLOUDFLARE_API_TOKEN` is set without `GUARD_TEST_ALLOW_REMOTE=1`, so they cannot accidentally hit a production account.

### Migrations

D1 migrations ship inside the package (`migrations/`). Apply them with:

```bash
wug migrate           # remote (default)
wug migrate --local   # local D1 emulator
```

## Forecast mode

Per-worker opt-in. When enabled, the scan projects current billing-period usage forward by `forecastLookaheadSeconds` (default 600) and fires a breach if the projection crosses a threshold — even if the current value hasn't.

Forecast breaches carry `ruleId = "forecast:<original>"` in the activity log and in notification payloads so you can distinguish them from threshold breaches.

```ts
// ACCOUNTS_JSON shape
{
  accountId: "a",
  billingCycleDay: 1,
  workers: [
    {
      scriptName: "api",
      thresholds: { requests: 500_000 },
      forecast: true,
      forecastLookaheadSeconds: 600
    }
  ],
  globalProtected: []
}
```

Because forecast breaches share the same `breachType` as the underlying threshold, cooldown + grace protect against duplicate kill-switch invocations on the same day.
