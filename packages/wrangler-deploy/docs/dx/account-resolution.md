# Account Resolution Decision Tree

Use this guide when `wrangler-deploy` is logged into Wrangler but you also need predictable account targeting.

## Resolution Order

`wd` resolves account id in this order:

1. `--account-id <id>`
2. `CLOUDFLARE_ACCOUNT_ID`
3. `.wdrc` `accountId`
4. `.wdrc` `stageAccounts[<stage>]` (for stage-aware runs)
5. `wrangler whoami` / Wrangler OAuth fallback config

## Recommended Team Setup

1. Pin defaults in `.wdrc`.
2. Use `stageAccounts` when stages map to different Cloudflare accounts.
3. In CI, set both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Use `wd auth doctor --json` in prechecks.
5. For mutating commands, use `--require-account-match` to fail fast on profile/account drift.

## Quick Flows

### Local, Wrangler login only

- Run `wrangler login`
- Run `wd auth check`
- Run `wd auth pin --stage dev`

### Local, explicit account per stage

- Add to `.wdrc`:

```json
{
  "stageAccounts": {
    "dev": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "production": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
```

### CI/CD

- Export:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Run `wd preflight --json`
- Run `wd check --pack full --json`

## Fast Diagnostics

- `wd auth status` shows currently selected profile/account source.
- `wd auth doctor` shows precedence matrix.
- `wd auth doctor --json` includes machine-readable diagnostics codes.
- `wd preflight --fix` can write missing `.wdrc` defaults for stage/account.

