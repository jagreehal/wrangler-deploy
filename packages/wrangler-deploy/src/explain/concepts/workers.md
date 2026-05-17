# workers

A **worker** is a deployable Cloudflare Worker tracked by wd. Each entry
in the `workers` array of `wrangler-deploy.config.ts` points at a directory
containing a worker source root (typically `src/index.ts`) and an optional
`wrangler.toml` / `wrangler.jsonc` declaring its bindings.

wd's view of a worker:

- **workerPath** — the declared path, e.g. `apps/api`. This is the stable
  identifier used in state, deploys, routing, and dependency graphs.
- **rendered config** — `.wrangler-deploy/<stage>/<workerPath>/wrangler.jsonc`,
  produced by `wd apply`.
- **deployed name** — what shows up in the Cloudflare dashboard; usually
  derived as `<base>-<stage>` (e.g. `api-staging`).
- **versionId / URL / routes** — recorded in state after each successful deploy.

Deploy ordering is dependency-aware: a worker bound to another worker via
service or DO bindings is deployed *after* the worker it depends on.
`wd graph` visualizes the topology; `wd impact <workerPath>` shows what a
change to one worker would cascade to.

`wd deploy --only apps/api` scopes to a single worker. `wd deploy --changed`
limits to workers whose source files changed since the last git commit.

## See also

- Concepts: `wd explain bindings`, `wd explain rendered-configs`, `wd explain stages`
- Commands: `wd deploy`, `wd up`, `wd graph`, `wd impact`, `wd tail`, `wd dev`
