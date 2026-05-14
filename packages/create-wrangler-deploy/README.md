# create-wrangler-deploy

Scaffold a new Cloudflare Workers project with [`wrangler-deploy`](https://wrangler-deploy.dev/).

```bash
npm create wrangler-deploy@latest my-app
# or
pnpm create wrangler-deploy@latest my-app
# or
yarn create wrangler-deploy my-app
# or
bun create wrangler-deploy my-app
```

After the scaffold, dependencies are installed and you can run:

```bash
cd my-app
pnpm dev      # local dev on http://localhost:8787
pnpm deploy   # deploy to the edge
```

## What you get

The default template is a bare hello-world Worker — no frontend, no bindings, just the smallest thing that works. Edit `src/index.ts`, hit save, watch `wrangler dev` reload.

Variants:

```bash
npm create wrangler-deploy@latest my-app vite   # Hono + Vite + typed KV binding
```

## What this package does

It's a thin shim. The actual scaffold logic and CLI live in `wrangler-deploy`. This package just forwards your args via `npx` so `npm create wrangler-deploy` always picks up the latest CLI.
