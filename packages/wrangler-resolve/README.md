# node-env-resolver-cloudflare

Cloudflare Workers integration for `node-env-resolver`.

It provides:
- `wrangler-resolve` CLI wrapper for `wrangler dev`, `wrangler deploy`, and `wrangler types`
- Safe env injection for local dev via `--env-file` + FIFO on Unix
- Deploy-time split of non-sensitive vars (`--var`) vs sensitive secrets (`--secrets-file`)
- Explicit sensitivity support from schema validator metadata (for example `secret()`), with key-pattern fallback
- Chunking support for serialized env blobs when secrets exceed Cloudflare's 5KB limit
- A `cf://` reference handler for resolving values from Workers `env` bindings
- Resolver-driven watch graph support via `resolver.metadata.watchPaths` (with naming-convention fallback)

## Install

```bash
npm install node-env-resolver-cloudflare
```

Peer dependency:

```bash
npm install node-env-resolver
```

## CLI

```bash
npx wrangler-resolve dev
npx wrangler-resolve deploy
npx wrangler-resolve versions upload
npx wrangler-resolve types
```

All unrecognized commands are passed through to Wrangler.

### CLI notes

- `dev` refuses to run if `.dev.vars` exists, because `wrangler-resolve` manages env injection itself.
- `deploy` manages `--secrets-file` automatically; do not pass `--secrets-file` manually.
- Set `NER_CF_DEBUG=1` to enable debug logging.

### Custom config

By default, the CLI uses `processEnv()` as the resolver source.

To provide custom resolvers, set `NER_CF_CONFIG` to a module path that exports WranglerFacade options:

```ts
// wrangler-resolve.config.ts
import { dotenv } from 'node-env-resolver/resolvers';

export default {
  resolvers: [[dotenv('.env.local'), {}]],
  watchPaths: ['.env.local', '.env.local.secrets'],
};
```

```bash
NER_CF_CONFIG=./wrangler-resolve.config.ts npx wrangler-resolve dev
```

## Programmatic usage

```ts
import { WranglerFacade } from 'node-env-resolver-cloudflare';
import { dotenv } from 'node-env-resolver/resolvers';

const facade = new WranglerFacade({
  resolvers: [[dotenv('.env.local'), {}]],
});

await facade.dev();
```

### Watch strategy

When `watchPaths` is not provided, you can control auto-detection:

```ts
const facade = new WranglerFacade({
  resolvers: [[dotenv('.env.local'), {}]],
  watchStrategy: 'auto', // 'auto' (default) | 'metadata' | 'fallback'
});
```

- `auto` (default): use resolver metadata/naming-derived paths, fallback to `.env`, `.env.local`, `.env.development`, `.env.development.local` if none found.
- `metadata`: use resolver-derived paths only (no fallback).
- `fallback`: ignore resolver metadata and use `.env`, `.env.local`, `.env.development`, `.env.development.local`.

## `cf://` handler

```ts
import { createCloudflareHandler } from 'node-env-resolver-cloudflare/handlers';

const handler = createCloudflareHandler({ env });
// resolves values like cf://MY_SECRET from Workers env bindings
```

## Exports

- `node-env-resolver-cloudflare`
- `node-env-resolver-cloudflare/handlers`
- `node-env-resolver-cloudflare/wrangler`
- `node-env-resolver-cloudflare/chunking`
- `node-env-resolver-cloudflare/fifo`
