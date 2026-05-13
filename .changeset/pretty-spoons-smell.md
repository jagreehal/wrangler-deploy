---
"wrangler-deploy": patch
---

Account resolution and rendered configs are safer and easier to reason about:

- **Resolution order:** `CLOUDFLARE_ACCOUNT_ID`, then `.wdrc` / `.wdrc.json` `accountId`, then `wrangler whoami`, then OAuth `~/.wrangler/config/default.toml` only when **`CLOUDFLARE_API_TOKEN` is not set**. With a token set, `default.toml` is never read, avoiding Cloudflare API **error 10000** (token vs wrong account).
- **Validation:** env and `.wdrc` account ids must be 32 hex characters (whitespace trimmed); invalid values fail with actionable errors.
- **Rendered configs:** when the repo root is known, generated Wrangler configs include a pinned **`account_id`** aligned with `getWranglerEnv()`, with fallback to the base config’s `account_id` if resolution throws.
- **Docs:** README Auth section expanded; Vitest mocks / env in tests avoid flaky `wrangler whoami` where rendering or dev plans resolve the account.
