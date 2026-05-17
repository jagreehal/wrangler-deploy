---
"wrangler-deploy": patch
---

Improve account resolution, auth diagnostics, and first-deploy ergonomics.

**Account resolution**
- Resolve Cloudflare account ID in a documented order: `--account-id`, `CLOUDFLARE_ACCOUNT_ID`, `.wdrc` `accountId`, per-stage `stageAccounts[<stage>]`, then `wrangler whoami` / Wrangler config fallback.
- Add `resolveAccount()` with source metadata (`flag`, `env`, `project-context`, `whoami`, `wrangler-config`) for JSON output and diagnostics.
- Warn when `--account-id` disagrees with the active profile; add `--require-account-match` to fail mutating commands on profile/account drift.
- Apply `stageAccounts` from `.wdrc` when no explicit account override is set.
- Pin account defaults with `wd auth pin` and `wd init --account auto` (writes `.wdrc`).

**New commands**
- `wd auth` (`status`, `check`, `switch`, `doctor`, `pin`) — show effective auth/account, validate API access, and manage defaults.
- `wd bootstrap` — guided configure/login/context/doctor onboarding.
- `wd preflight` — auth + dry-run safety checks before mutating work (`--fix` can seed missing `.wdrc` defaults).
- `wd up` (`u`) — apply then deploy a stage in one shot.
- `wd tail` — stream Wrangler logs for one or all workers in a stage.
- `wd actions` — categorized command sitemap with examples and suggested next steps (`--json` for agents).
- `wd upgrade-check` — compare installed version to latest on npm.
- `wd explain <concept>` — bundled concept docs (workers, stages, bindings, state, resources, hypermedia, rendered configs).

**Wrangler compatibility**
- Enforce installed Wrangler `>=3.91.0` (required for `-c` rendered configs); widen peer dependency to `>=3.91.0 <5`.
- Add `d1 execute` and `d1 migrations apply` passthroughs for remote/local SQL and migrations.

**Other fixes**
- Resolve `main`, `migrations_dir`, `assets.directory`, and `site.bucket` paths relative to the source worker directory in rendered configs (fixes D1 migrations and assets when configs live under `.wrangler-deploy/<stage>/`).
- Print auth context on mutating commands; include auth metadata in plan/apply/deploy JSON.
- Extend `wd doctor` with `--auth`, `wd dev` with `--mode` and `explain` subcommand, and `wd schema examples`.
