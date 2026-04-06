# CLAUDE.md

## Build and verify

See [CONTRIBUTING.md](CONTRIBUTING.md) for full setup, build, test, and smoke test instructions.

Quick reference:

```bash
pnpm install                # install deps
pnpm quality                # build + lint + typecheck + test (full CI check)
cd apps/smoke-test && pnpm test   # integration smoke tests (requires wrangler)
```

## Key conventions

- **No dynamic imports** — ESLint bans `await import()`. Use static imports. Only exception: user config loading in `src/cli/index.ts` (has eslint-disable comments).
- **Cloudflare types** — `@cloudflare/workers-types` is a dev dependency. The phantom type system in `src/typed.ts` imports real Cloudflare types via `import type` (not tsconfig `types` — that conflicts with Node DOM types).
- **Tests use executable-stories** — unit tests use `executable-stories-vitest` for BDD-style test narration with `story.init(task)`, `story.given(...)`, `story.then(...)`.
- **Smoke tests spawn real processes** — `apps/smoke-test/` starts actual wrangler dev servers. These are slower (~5s) and need wrangler installed.
- **Automatic port resolution** — `startDev()` probes for available ports before spawning. Both dev ports and inspector ports are resolved dynamically via `findAvailablePorts()` in `src/core/port-finder.ts`, so multi-worker dev "just works" without port conflicts. The `DevHandle` returned by `startDev()` exposes the actual resolved ports in `handle.ports`.
