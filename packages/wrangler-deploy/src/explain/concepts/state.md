# state

**State** is wd's local source of truth about what is provisioned in
Cloudflare for a given stage. It lives at
`.wrangler-deploy/<stage>/state.json` and is read by every lifecycle
command before talking to Cloudflare.

Contents:

- `resources` — map of declared resource keys to their Cloudflare IDs
  (KV namespace IDs, D1 UUIDs, R2 bucket names, queue IDs, etc.).
- `workers` — map of `workerPath` to last-deployed `{ name, versionId, url, routes }`.
- `deploymentHistory` — append-only log of `apply`/`deploy`/`rollback` events.
- `secrets` — encrypted secret declarations (values, not keys, are encrypted).
- `createdAt` / `updatedAt` — timestamps for staleness checks.

State is **always committed** by default (`.wrangler-deploy/` is checked in)
so that team members and CI agree on the resource graph. Optionally encrypt
with `wd context set --state-password <pwd>` or `WD_STATE_PASSWORD`.

When state is missing for a stage, every command that reads it emits
`WD_E_STATE_MISSING` and directs you to `wd apply --stage <name>`. When
state exists but the corresponding Cloudflare resources have been deleted
out-of-band, `wd status --diff` will surface drift. Use `wd doctor` for a
full health check.

## See also

- Concepts: `wd explain stages`, `wd explain resources`, `wd explain rendered-configs`
- Commands: `wd apply`, `wd status`, `wd state list`, `wd doctor`
- Errors: `wd explain WD_E_STATE_MISSING`
