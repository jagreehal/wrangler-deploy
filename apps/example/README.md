# wrangler-deploy example

A 3-worker Cloudflare application demonstrating wrangler-deploy's environment orchestration.

All resources are fully managed by Cloudflare. No external database, no Docker, no connection strings.

## Local dev

```bash
pnpm dev
# api: http://localhost:8787
# batch-workflow: http://localhost:8789
# event-router: http://localhost:8788
```

D1 runs locally via Miniflare. No setup needed.

## Stage management

```bash
wd plan --stage staging          # see what would be created
wd apply --stage staging         # provision D1, KV, Queues
wd deploy --stage staging        # deploy all 3 workers
wd status --stage staging        # check status
wd destroy --stage staging       # tear down
```

## Ephemeral environments

```bash
wd apply --stage pr-123          # own D1, KV, Queues
wd deploy --stage pr-123
# ... test ...
wd destroy --stage pr-123        # all gone
wd gc                            # cleanup expired stages
```
