# workers-usage-guard-shared

Shared types and pure helpers used by [`workers-usage-guard`](https://www.npmjs.com/package/workers-usage-guard) (the deployed Worker) and [`wrangler-deploy`](https://www.npmjs.com/package/wrangler-deploy) (the Node CLI).

This package contains:

- **Types** — `AccountConfig`, `WorkerConfig`, `UsageSnapshot`, `UsageReport`, `BreachForensic`, threshold and rule definitions.
- **`signRequest` / `verifyRequest`** — HMAC-SHA-256 helpers for the guard signed-request protocol (`x-guard-timestamp` + `x-guard-signature`).
- **GraphQL helpers** — query builders for the Cloudflare Workers Analytics GraphQL endpoint used by the guard.

You normally do not install this package directly — it is pulled in transitively by `workers-usage-guard` and `wrangler-deploy`. Install it explicitly only if you are building your own client against the guard API.

## Install

```bash
npm install workers-usage-guard-shared
```

## Usage

```ts
import { signRequest, type AccountConfig } from "workers-usage-guard-shared";

const timestamp = new Date().toISOString();
const signature = await signRequest({
  method: "GET",
  path: "/api/breaches?account=1234abcd",
  timestamp,
  key: process.env.GUARD_API_SIGNING_KEY!,
});

const res = await fetch("https://workers-usage-guard.example.workers.dev/api/breaches?account=1234abcd", {
  headers: {
    "x-guard-timestamp": timestamp,
    "x-guard-signature": signature,
  },
});
```

## Stability

`0.x` — APIs may change between minor versions until `1.0`. Pin a minor range (`^0.1`) if you depend on a specific shape.

## License

MIT — see [LICENSE](./LICENSE).
