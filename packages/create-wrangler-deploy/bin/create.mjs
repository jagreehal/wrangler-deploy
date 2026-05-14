#!/usr/bin/env node
// Thin shim: `npm create wrangler-deploy@latest <dir>` → `wrangler-deploy create <dir>`.
//
// We deliberately don't bundle scaffold logic here — it lives in
// `wrangler-deploy`. npm's `create-<name>` convention auto-runs this bin when
// you type `npm create <name>` (and the pnpm/yarn/bun equivalents). Forwarding
// to the real CLI via `npx` means scaffolding always matches the user-pinned
// wrangler-deploy version and we don't duplicate template code.

import { spawn } from "node:child_process";

// Forward every CLI argument verbatim so flags like --no-install and --force
// work the same as `wd create`. The `--package wrangler-deploy@latest` pin
// guarantees we pull the matching CLI, and `--yes` skips the npx install
// prompt that would otherwise stall the scaffolder.
const args = ["--yes", "--package", "wrangler-deploy@latest", "wrangler-deploy", "create", ...process.argv.slice(2)];

const child = spawn("npx", args, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
child.on("error", (err) => {
  console.error("create-wrangler-deploy: failed to spawn npx —", err.message);
  process.exit(1);
});
