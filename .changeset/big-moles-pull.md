---
"wrangler-deploy": minor
---

Add repo-aware local development workflows

New local runtime commands that resolve workers, ports, queues, and routes from `wrangler-deploy.config.ts`:

- `wd dev --session --persist-to` - shared Wrangler Queue session mode
- `wd dev doctor` - preflight checks before dev startup
- `wd dev ui` - local control plane for runtime workflows
- `wd verify local` - config-driven local smoke tests with named packs
- `wd snapshot save/load/list` - reproducible local state
- `wd logs` - tail persisted worker logs
- `wd worker call/routes` - resolve and call local workers by path
- `wd d1 list/inspect/exec/seed/reset` - D1 workflows by logical name
- `wd cron trigger/loop` - scheduled route testing
- `wd queue list/inspect/send/replay/tail` - queue topology and local injection
- `wd fixture list` - shared fixtures for worker calls, queue sends, D1 queries

New configuration:

- `verifyLocal.checks` - local verification harness
- `verifyLocal.packs` - named smoke/regression packs
- `fixtures` - reusable test payloads and SQL
- `dev.session` - shared Miniflare state configuration
- `dev.ports` - per-worker dev port preferences
- `dev.queues` - local queue injection routes
- `dev.endpoints` - named local HTTP endpoint shortcuts
- `dev.d1` - D1 seed, reset, and default worker config
- `dev.companions` - local-only helper processes
- `dev.snapshots` - local state directories to snapshot

The practical win is repo-awareness. Instead of remembering which worker owns a queue, which port it's on, or which local route to hit, you use logical names from one project config. Wrangler remains the engine. wrangler-deploy turns that engine into workflows for multi-worker repos.
