# Remote State (Implemented)

## Usage

```ts
// wrangler-deploy.config.ts
export default defineConfig({
  version: 1,
  state: {
    backend: "kv",
    namespaceId: "your-kv-namespace-id", // KV namespace ID
    keyPrefix: "wrangler-deploy/", // default prefix
  },
  // ... rest of config
});
```

## Setup

1. Create a KV namespace in Cloudflare:

   ```bash
   wrangler kv:namespace create wrangler-deploy-state
   ```

2. Copy the namespace ID from the output and set it as `namespaceId` in your config.

3. Authentication:
   - **Local development:** Run `wrangler login`. The account ID is auto-resolved from `wrangler whoami`.
   - **CI/CD:** Set `CLOUDFLARE_API_TOKEN` and optionally `CLOUDFLARE_ACCOUNT_ID` environment variables. If `CLOUDFLARE_ACCOUNT_ID` is not set, it is auto-resolved via `wrangler whoami`.

## How it works

- `resolveStateProvider(rootDir, config.state)` returns the appropriate provider
- All commands (`apply`, `deploy`, `destroy`, `verify`, `gc`, `secrets`, `status`) use the `StateProvider` interface
- Local fallback: set `backend: "local"` or omit the `state` config

## Migration from local state

Run this once to push existing local state to KV:

```ts
// migration script
import { LocalStateProvider, KvStateProvider } from "wrangler-deploy";

const local = new LocalStateProvider(rootDir);
const kv = new KvStateProvider(rootDir, "your-namespace-id");

for (const stage of await local.list()) {
  const state = await local.read(stage);
  if (state) {
    await kv.write(stage, state);
    console.log(`Migrated ${stage}`);
  }
}
```
