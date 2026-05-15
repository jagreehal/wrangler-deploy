---
"wrangler-deploy": patch
---

Fix the `vite` starter scripts to be package-manager agnostic.

Previously, the generated `dev` script hardcoded `pnpm` subcommands, which broke
for users scaffolding with `npm` or `yarn`. The starter now runs `vite` and
`wrangler` directly, and uses `wrangler dev --cwd workers/api --port 8787` for
the worker command.
