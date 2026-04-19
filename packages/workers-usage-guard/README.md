# workers-usage-guard

Control-plane Cloudflare Worker that monitors Workers usage (requests, CPU ms, estimated cost) across configured accounts and automatically detaches public entry points (zone routes, custom domains) when thresholds are crossed. Fans breach and daily-report events out to pluggable notification channels (Discord, Slack, generic webhooks).

Built and maintained with superpowers for Claude Code. Implementation plans and design spec live in `docs/superpowers/` — load the `wrangler-deploy` skill in Claude Code for AI-assisted usage.

### CLI integration (Phase 2)

If you also use `wrangler-deploy` in the same repo, you can run `wd guard status` to pull live Cloudflare Workers usage for the same accounts without deploying this guard. See the wrangler-deploy README.

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

## First deploy

1. Create the D1 database.

   ```bash
   wrangler d1 create workers-usage-guard
   ```

   Copy the `database_id` into `wrangler.jsonc`.

2. Run the migration.

   ```bash
   wrangler d1 migrations apply workers-usage-guard --remote
   ```

3. Configure `vars` in `wrangler.jsonc` or via `wrangler deploy --var`:

   - `ACCOUNTS_JSON` — an array of `AccountConfig` describing which accounts and workers to monitor, their thresholds, and which scripts are protected.
   - `NOTIFICATIONS_JSON` — an object with a `channels` array. Each channel entry references a secret by name (`webhookUrlSecret` for Discord/Slack, `urlSecret` for generic webhooks).

4. Set the required secrets.

   Always required:

   ```bash
   wrangler secret put CLOUDFLARE_API_TOKEN
   wrangler secret put GUARD_API_SIGNING_KEY
   ```

   Per channel listed in `NOTIFICATIONS_JSON`, set the named secret, e.g.:

   ```bash
   wrangler secret put DISCORD_PROD_WEBHOOK
   wrangler secret put SLACK_ENG_WEBHOOK
   wrangler secret put OPS_WEBHOOK_URL
   ```

5. Deploy.

   ```bash
   wrangler deploy
   ```

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

### Migration 0002

Phase 3b adds a `runtime_protected` D1 table to hold runtime kill-switch overrides added via `wd guard disarm`. Apply with:

```bash
wrangler d1 migrations apply workers-usage-guard --remote
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
