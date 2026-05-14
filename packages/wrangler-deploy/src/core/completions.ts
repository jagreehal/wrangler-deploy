import { AgentErrors } from "./cli-output.js";

const COMMANDS = [
  "init",
  "create",
  "introspect",
  "plan",
  "apply",
  "deploy",
  "rollback",
  "history",
  "env",
  "lock",
  "replay",
  "route",
  "onboard",
  "destroy",
  "check",
  "quickstart",
  "release-note",
  "gc",
  "status",
  "secrets",
  "verify",
  "graph",
  "impact",
  "diff",
  "dev",
  "snapshot",
  "logs",
  "cron",
  "worker",
  "fixture",
  "d1",
  "queue",
  "ci",
  "doctor",
  "explain",
  "schema",
  "tools",
  "context",
  "macro",
  "state",
  "configure",
  "login",
  "logout",
  "profile",
  "telemetry",
  "util",
  "completions",
];

export function generateCompletions(shell: "zsh" | "bash" | "fish"): string {
  if (shell === "zsh") {
    return `#compdef wd

_wd() {
  local -a commands stages workers
  stages=($(command ls -1 .wrangler-deploy 2>/dev/null))
  workers=($(command ls -1 workers 2>/dev/null))
  commands=(
${COMMANDS.map((cmd) => `    '${cmd}'`).join("\n")}
  )
  _arguments \
    '--stage[Stage name]:stage:(\${stages})' \
    '--worker[Worker path or deployed name]:worker:(\${workers})' \
    '--fallback-stage[Fallback stage]:stage:(\${stages})' \
    '--format[Output format]:format:(json text ndjson)' \
    '--watch[Watch for changes]' \
    '--verify[Run verification]' \
    '--open[Open deployed URL after deploy]' \
    '--dashboard[Open dashboard after deploy]' \
    '--print-url[Print URL without opening browser]' \
    '--no-open[Do not open browser]' \
    '*::command:->commands'
  case $state in
    commands)
  _describe 'command' commands
      ;;
  esac
}

compdef _wd wd
`;
  }

  if (shell === "bash") {
    return `# bash completion for wd
_wd_completions() {
  local cur="${"${COMP_WORDS[COMP_CWORD]}"}"
  local prev="${"${COMP_WORDS[COMP_CWORD-1]}"}"
  local commands="${COMMANDS.join(" ")}"
  local stages="$(ls -1 .wrangler-deploy 2>/dev/null | tr '\\n' ' ')"
  local workers="$(ls -1 workers 2>/dev/null | tr '\\n' ' ')"
  local flags="--stage --worker --fallback-stage --format --watch --verify --plan-only --open --dashboard --print-url --copy --latest --no-open --strict --diff --only --only-resources --since --tail --grep-json --interval-ms --output --fail-on-drift --error-code --versioned --canary --lock --zone-id"
  if [[ "$prev" == "--stage" || "$prev" == "--fallback-stage" ]]; then
    COMPREPLY=($(compgen -W "$stages" -- "$cur"))
    return 0
  fi
  if [[ "$prev" == "--worker" ]]; then
    COMPREPLY=($(compgen -W "$workers" -- "$cur"))
    return 0
  fi
  if [[ "$cur" == --* ]]; then
    COMPREPLY=($(compgen -W "$flags" -- "$cur"))
    return 0
  fi
  COMPREPLY=($(compgen -W "$commands" -- "$cur"))
}

complete -F _wd_completions wd
`;
  }

  if (shell === "fish") {
    const commands = COMMANDS.map(
      (cmd) => `complete -c wd -f -n '__fish_use_subcommand' -a ${cmd}`,
    ).join("\n");
    const flags = [
      "complete -c wd -l stage -r -d 'Stage name'",
      "complete -c wd -l worker -r -d 'Worker path or name'",
      "complete -c wd -l fallback-stage -r -d 'Fallback stage'",
      "complete -c wd -l open -d 'Open deployed URL after deploy'",
      "complete -c wd -l dashboard -d 'Open Cloudflare dashboard after deploy'",
      "complete -c wd -l print-url -d 'Print target URL without opening browser'",
      "complete -c wd -l no-open -d 'Disable browser opening'",
      "complete -c wd -l plan-only -d 'Show deploy actions only'",
      "complete -c wd -l copy -d 'Copy URL to clipboard'",
      "complete -c wd -l latest -d 'Use last deployed worker'",
      "complete -c wd -l canary -r -d 'Canary traffic percentage for new version'",
      "complete -c wd -l lock -d 'Acquire stage lock during deploy'",
      "complete -c wd -l zone-id -r -d 'Cloudflare zone id for route apply'",
      "complete -c wd -l strict -d 'Fail on warnings'",
      "complete -c wd -l diff -d 'Show delta in watch mode'",
      "complete -c wd -l only -r -d 'Scope to worker'",
      "complete -c wd -l only-resources -r -d 'Scope to resources'",
      "complete -c wd -l since -r -d 'Relative time filter for logs'",
      "complete -c wd -l tail -r -d 'Tail last N lines'",
      "complete -c wd -l grep-json -r -d 'Filter JSON log lines by key'",
      "complete -c wd -l interval-ms -r -d 'Status watch poll interval'",
      "complete -c wd -l output -r -d 'Status output mode'",
      "complete -c wd -l fail-on-drift -d 'Fail CI if drift detected'",
      "complete -c wd -l error-code -r -d 'Explain WD_E_* code'",
      "complete -c wd -l versioned -d 'Versioned schema envelope'",
    ].join("\n");
    return `${commands}\n${flags}\n`;
  }

  // This should be unreachable due to TypeScript's exhaustive check
  throw AgentErrors.validation(`Unknown shell: ${shell}`, "Pass --shell zsh|bash|fish.", { flag: "--shell" });
}
