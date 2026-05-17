# stages

A **stage** is a named slice of your project's deployment universe: e.g. `dev`,
`staging`, `pr-123`, `prod`. Every wd lifecycle command (`apply`, `deploy`,
`status`, `destroy`, `up`) targets exactly one stage.

Each stage owns:

- Its own provisioned **resources** (KV, D1, R2, Vectorize, Queues, Hyperdrive).
- Its own **rendered worker configs** (one `wrangler.jsonc` per worker per
  stage, with bindings populated from the stage's resources).
- Its own **state file** at `.wrangler-deploy/<stage>/state.json` — the
  source of truth for what wd believes is provisioned.
- Optional **protection flags** (declared in `wrangler-deploy.config.ts`)
  that gate destructive commands.

Stage names come from (highest precedence first):

1. `--stage <name>` on the command line.
2. `WD_STAGE` environment variable.
3. The `stage` field in your `.wdrc` (set via `wd context set --stage <name>`).
4. `$USER` as a last-resort default for non-shared environments.

A stage exists from the moment `wd apply --stage <name>` succeeds. Before that,
commands that read state (e.g. `wd deploy`, `wd status`) emit
`WD_E_STATE_MISSING` and point you at `wd apply`.

## See also

- Concepts: `wd explain resources`, `wd explain state`, `wd explain rendered-configs`
- Commands: `wd apply`, `wd deploy`, `wd up`, `wd destroy`, `wd status`
- Errors: `wd explain WD_E_STATE_MISSING`
