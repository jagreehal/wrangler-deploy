# bindings

A **binding** is the contract between a worker and a Cloudflare resource:
when your worker code calls `env.MY_KV.get(...)`, the `MY_KV` name is a
binding. Bindings appear in the rendered `wrangler.jsonc` and resolve to
either a local Miniflare resource (`wd dev`) or a remote Cloudflare
resource (`wd deploy`).

Categories handled by wd:

- **KV namespaces** — `[[kv_namespaces]]` with `binding` + `id`.
- **D1 databases** — `[[d1_databases]]` with `binding` + `database_id`.
- **R2 buckets** — `[[r2_buckets]]` with `binding` + `bucket_name`.
- **Vectorize indexes** — `[[vectorize]]` with `binding` + `index_name`.
- **Queues** — both `[[queues.producers]]` and `[[queues.consumers]]`.
- **Hyperdrive** — `[[hyperdrive]]` configs derived from `--database-url`.
- **Service / Durable Object bindings** — wired between workers in the same project.
- **Secrets** — declared in config, pushed via `wd secrets sync`.
- **Vars** — plain text vars from `vars` blocks or `.env`.

You never edit rendered `wrangler.jsonc` files by hand. They are generated
by `wd apply` from your `wrangler-deploy.config.ts` plus the stage's
allocated resource IDs. Hand-edits will be overwritten next apply, and
`wd doctor` will warn if rendered configs drift from declared bindings.

## See also

- Concepts: `wd explain resources`, `wd explain rendered-configs`, `wd explain workers`
- Commands: `wd apply`, `wd plan`, `wd env diff`, `wd secrets sync`
- Errors: `wd explain WD_E_RENDERED_CONFIG_STALE`
