# resources

A **resource** is a Cloudflare primitive that wd provisions on your behalf
when you run `wd apply`: KV namespaces, D1 databases, R2 buckets,
Vectorize indexes, Queues, and Hyperdrive configs.

Resources are declared in `wrangler-deploy.config.ts` under the
`resources` map. Each entry has:

- A **declared key** (your project-local handle, e.g. `cache_kv`).
- A **type** (`kv`, `d1`, `r2`, `vectorize`, `queue`, `hyperdrive`).
- Optional **per-stage overrides** (different names per stage, protection, TTL).

`wd apply` reconciles desired state vs current state:

- **create** — declared, not provisioned yet.
- **adopt** — declared, but a resource with the expected name already exists
  in your account (wd records its ID instead of creating a duplicate).
- **in-sync** — already provisioned and matches.
- **drifted** — provisioned but settings differ from declared.
- **orphaned** — provisioned but no longer declared (eligible for cleanup).

Resources are referenced from worker code through **bindings**. The link
is: declared resource → stage-scoped Cloudflare ID → rendered worker binding
→ `env.MY_BINDING` at runtime.

## See also

- Concepts: `wd explain bindings`, `wd explain stages`, `wd explain state`
- Commands: `wd apply`, `wd plan`, `wd state list`, `wd destroy`
