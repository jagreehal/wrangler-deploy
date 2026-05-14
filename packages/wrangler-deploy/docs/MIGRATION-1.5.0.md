# Migration Notes: 1.5.0

This release adds new commands and flags focused on iterative deploy UX, troubleshooting, and machine-friendly outputs.

## New commands

- `wd check`
- `wd rollback`
- `wd rollback list`
- `wd history`
- `wd macro list|save|run`
- `wd macro validate`
- `wd quickstart`
- `wd telemetry on|off|status`
- `wd release-note`

## New flags worth adopting

- Deploy/apply/plan scope:
  - `wd deploy --changed`
  - `wd deploy --only <worker>`
  - `wd apply --only-resources <name|type>`
  - `wd plan --only-resources <name|type>`
- Browser/URL handling:
  - `wd open --latest --copy`
  - `wd dashboard --latest --print-url`
- Observability and safety:
  - `wd deploy --plan-only`
  - `wd rollback --latest --verify`
  - `wd status --summary`
  - `wd status --watch --diff`
  - `wd status --output ndjson`
  - `wd status --fail-on-drift`
  - `wd apply --interactive`
  - `wd destroy --interactive`
  - `wd logs --tail 200 --grep-json level`
  - `wd profile test`
  - `wd explain --from-last-error`
  - `wd explain --error-code WD_E_STATE_MISSING`

## Automation updates

- Prefer `wd schema --versioned` for machine consumers pinned to a schema contract.
- Keep using `wd schema outputs` for output payload schemas.
- Use `wd schema outputs --command <name>` to fetch one command schema only.
- Use `wd context export` / `wd context import` for portability between local dev and CI.
- Errors now include stable-ish internal codes (`WD_E_*`) in JSON mode.

## Suggested rollout

1. Update scripts to use scoped deploy/apply (`--changed`, `--only`, `--only-resources`).
2. Add `wd check --stage <name>` to CI preflight.
3. Introduce `wd status --summary` for concise CI logs.
4. Enable telemetry only where local performance diagnostics are needed.
