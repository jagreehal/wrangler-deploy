---
"wrangler-deploy": patch
---

Improve starter scaffolding for frontend users.

- Add a new `react` option to `wd create` that first attempts to scaffold via
  official `create-cloudflare` (React + Workers), then applies wrangler-deploy
  migration defaults.
- Add a robust fallback path for `react` scaffolding that pulls
  `cloudflare/templates` `vite-react-template` if `create-cloudflare` fails or
  returns an unexpected project shape.
- Apply wrangler-deploy migration to React scaffolds:
  `wrangler-deploy.config.ts`, `wd` scripts (`plan`, `apply`, `status`,
  `deploy:stage`), and `wrangler-deploy` dev dependency.
- Normalize scaffolded React package name to the target directory name.
- Fix the `vite` starter `dev` scripts to be package-manager agnostic by
  removing hardcoded `pnpm` subcommands.
