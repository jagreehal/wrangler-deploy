---
"wrangler-deploy": minor
---

Add `wd guard` commands and `/guard` dev UI for Workers usage monitoring.

A new `guard` config section lets you point `wrangler-deploy` at a deployed `workers-usage-guard` Worker. Once configured, the CLI gains five subcommands:

- `wd guard status` — show current breach/armed state
- `wd guard breaches` — list recent threshold breaches
- `wd guard report` — fetch the latest daily usage report
- `wd guard arm` — re-enable kill-switch protection after a disarm
- `wd guard disarm` — temporarily disable kill-switch protection

The dev UI (`wd dev`) now includes a `/guard` page that surfaces the same status and breach information in the browser.

All requests to the guard Worker are signed with HMAC using the shared secret from the guard config, keeping the API private without requiring Cloudflare Access.

Forecast mode (opt-in via `forecastMode: true` in the worker config) fires breach notifications when projected month-end usage is on track to exceed the threshold, not just when usage has already crossed it.
