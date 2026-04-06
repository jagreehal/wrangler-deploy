const COMMANDS = [
  "init",
  "introspect",
  "plan",
  "apply",
  "deploy",
  "destroy",
  "gc",
  "status",
  "secrets",
  "verify",
  "graph",
  "impact",
  "diff",
  "dev",
  "ci",
  "doctor",
  "completions",
];

export function generateCompletions(shell: "zsh" | "bash" | "fish"): string {
  if (shell === "zsh") {
    return `#compdef wd

_wd() {
  local -a commands
  commands=(
${COMMANDS.map((cmd) => `    '${cmd}'`).join("\n")}
  )
  _describe 'command' commands
}

compdef _wd wd
`;
  }

  if (shell === "bash") {
    return `# bash completion for wd
_wd_completions() {
  local cur="${"${COMP_WORDS[COMP_CWORD]}"}"
  local commands="${COMMANDS.join(" ")}"
  COMPREPLY=($(compgen -W "$commands" -- "$cur"))
}

complete -F _wd_completions wd
`;
  }

  if (shell === "fish") {
    return COMMANDS.map(
      (cmd) => `complete -c wd -f -n '__fish_use_subcommand' -a ${cmd}`,
    ).join("\n") + "\n";
  }

  // This should be unreachable due to TypeScript's exhaustive check
  throw new Error(`Unknown shell: ${shell}`);
}
