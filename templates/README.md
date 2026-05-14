# Templates

Starter projects shipped with `npm create wrangler-deploy@latest`. Each subdirectory is a real, runnable Cloudflare Workers project — clone the directory, run `pnpm install && pnpm dev`, and it works.

## How they're used

When a user runs `npm create wrangler-deploy@latest my-app` and picks a template (interactively, or via `--template <name>`), the CLI fetches that subdirectory via [`giget`](https://github.com/unjs/giget) and writes it to disk, substituting placeholders.

Default `hello` template is *not* in this directory — it lives inline in the CLI (`packages/wrangler-deploy/src/core/create.ts`) so first-run scaffolding works offline with zero network.

## Placeholders

Files may reference these tokens; the CLI substitutes them at scaffold time:

- `{{projectName}}` — kebab-case package name (e.g. `my-app`)
- `{{projectTitle}}` — human-friendly title (e.g. `My App`)
- `{{compatibilityDate}}` — today's date in `YYYY-MM-DD` (used by `wrangler.jsonc`)

## Adding a new template

1. Create a new subdirectory with a runnable project.
2. Use `{{projectName}}` / `{{projectTitle}}` / `{{compatibilityDate}}` where appropriate.
3. Add an entry to `_index.json` so the picker can discover it.
4. Run `pnpm --filter wrangler-deploy build` (or just `pnpm build` from the repo root). The `prebuild` hook reads `_index.json` and regenerates `packages/wrangler-deploy/src/core/template-manifest.generated.ts`. Commit both.
5. The template ships at the next release with no other code changes.

CI runs `pnpm --filter wrangler-deploy verify:template-manifest`, which regenerates the file and fails if it differs from what's committed. That guarantees `_index.json` stays the single source of truth.

## Local development

When iterating on a template locally, point the CLI at this directory instead of GitHub:

```bash
export WD_TEMPLATES_PATH=/absolute/path/to/wrangler-deploy/templates
wd create my-thing
```

`WD_TEMPLATES_PATH` makes the CLI:
- read `_index.json` from disk (so new templates show up in the picker without rebuilding)
- copy the chosen template directory directly instead of fetching from GitHub
