---
"wrangler-deploy": minor
---

Agent-native CLI: significant expansion of the surface for AI-driven workflows, plus
ergonomic additions for humans.

**New commands**

- `check`, `rollback`, `macro`, `quickstart`, `telemetry`, `version`, `examples`,
  `tools`, `sandbox`, `configure`, `login`, `logout`, `profile`.

**New global agent flags** (work on every command)

- `--json` / `--ndjson` for machine output, plus `--fields a,b.c` projection.
- `--no-color`, `--no-interactive`, `--no-secrets-in-output`, `--quiet`.
- `--sandbox` (or `AGENT_SANDBOX=1`) for declarative refusal of mutating commands.
- `--output-file <path>` for first-result artifact persistence on every JSON-emitting
  command (auto-redacted under `--no-secrets-in-output`).
- `--input <path | ->` for reading JSON from a file or stdin (currently honoured by
  `plan`/`apply`/`deploy`).

**Structured errors**

- Every JSON failure returns `{ ok: false, command, error: { type, code, message,
  retryable, fix, expected, suggestions } }`.
- Stable `WD_E_*` codes with documented `error.type` enum.
- Exit codes: `0` success, `1` runtime, `2` validation/sandbox refusal.
- New `AgentErrors`/`assertStage`/`assertStageState`/`assertUsage` helpers for typed
  throws; ~200 internal throw sites migrated.
- New error path for missing prerequisites: manifest-declared `requiresAuth`
  commands fail-fast with `WD_E_AUTH_FAILED` and `error.expected.env` listing the
  missing env vars.

**Self-describing CLI**

- `wd schema --json`, `wd schema outputs [--command <name>] --json`, `wd schema
  config --json`, `wd schema errors --json`, `wd schema --versioned` for full
  introspection.
- `wd tools --json` for compact tool metadata.
- `wd examples [--command <name>] --json` for copy-pasteable per-command snippets.
- `wd version --json` returns binary metadata (node, platform, sandbox flag,
  manifest version, timestamp).

**Local dev event stream**

- `wd dev --json` (or `--ndjson`) emits NDJSON lifecycle + per-worker log events
  (`dev.starting`, `worker.ready`, `dev.ready`, `worker.log`, `worker.error`,
  `dev.stopping`, `dev.stopped`). Human-formatted log output is redirected to
  stderr in event mode so stdout stays parseable.
- Schema queryable via `wd schema outputs --command devEvent --json`.

**Sandbox**

- `wd sandbox info --json` detects the available OS sandbox (`sandbox-exec` on
  macOS, `bwrap` on Linux).
- `wd sandbox run -- <cmd>` executes a command inside a real OS sandbox.
- Outbound HTTP(S) is funneled through a local hostname-filtering proxy with a
  default Cloudflare/npm/GitHub allowlist; extend with `--allow-host <pattern>`
  (suffix-wildcard with leading dot) or disable with `--no-network-filter`.
- macOS: kernel-blocks all outbound TCP except the proxy port — raw TCP and tools
  that bypass `HTTP_PROXY` fail with `Operation not permitted`.
- Linux: pass `--strict-network` to use `--unshare-net` for full network isolation
  (no network at all). Default `bwrap` mode shares host network and only filters
  proxy-respecting traffic — documented honestly.

**Existing-command improvements**

- New troubleshooting path: `wd explain --from-last-error`.
- Open/dashboard ergonomics: `--latest`, `--copy`, `--print-url`, `--no-open`.
- Scoped iteration flags: `deploy --changed`, `deploy --only`, `apply/plan
  --only-resources`.
- Safety/operability flags: `apply/destroy --interactive`, `status --summary`,
  `status --diff`, `status --fail-on-drift`.
- New profile diagnostic: `wd profile test`.
- Context portability: `wd context export` / `wd context import`.
- Release summaries: `wd release-note [--mark-success]`.
- Macro hardening: `wd macro validate` and `wd macro run --dry-run`.
- Rollback ergonomics: `wd rollback --latest --verify`.
- Status/log output controls: `status --output`, `logs --tail`, `logs --grep-json`.
- Doctor detail modes: `wd doctor --codes`, `wd doctor --fix-dry-run`.
- `--dry-run` coverage extended to `init`, `create`, `ci init`, `macro save`,
  `snapshot save/load`.
- Added opt-in local telemetry (`wd telemetry on|off|status`) with timing NDJSON
  output.
