# {{projectTitle}}

Cloudflare Vite starter with a frontend, a worker API, and wrangler-deploy for stage-aware provisioning.

## Install

```bash
pnpm install
```

## Local dev

```bash
pnpm dev
```

Opens the Vite frontend at <http://localhost:5173>, with the worker API at <http://localhost:8787>. Vite proxies `/api` requests to the worker.

## Stage management

```bash
pnpm run plan      # preview what will be created
pnpm run apply     # provision resources (KV, etc.)
pnpm run deploy    # deploy workers in dependency order
```

The `--stage` is set to `staging` in the scripts; change it to whatever you want, or pass `--stage <name>` directly.

## What's in here

- `src/` — the Vite frontend (TypeScript + CSS)
- `workers/api/` — the Hono API worker, bound to a KV namespace
- `wrangler-deploy.config.ts` — declares the KV resource and stage rules
- `wrangler.jsonc` (per worker) — Wrangler's own config; not modified by wrangler-deploy

Run `wd help` for the full command list.
