export type ExplainResult = {
  query: string;
  summary: string;
  actions: string[];
};

type Entry = {
  match: RegExp;
  summary: string;
  actions: string[];
};

const ENTRIES: Entry[] = [
  {
    match: /\b10000\b|wd_e_account_mismatch|account.*mismatch/i,
    summary: "Token/account mismatch — your API token does not belong to CLOUDFLARE_ACCOUNT_ID.",
    actions: [
      "Set `CLOUDFLARE_ACCOUNT_ID` to the 32-char id that owns your API token.",
      "Verify the token's account in the Cloudflare dashboard.",
      "Run `wd doctor` to confirm auth and account resolution.",
    ],
  },
  {
    match: /wd_e_state_missing|no state found|stage not found/i,
    summary: "The target stage has not been provisioned yet.",
    actions: [
      "Run `wd apply --stage <name>` to create stage resources and rendered configs.",
      "Run `wd status` to list available stages.",
      "Set a default via `wd context set --stage <name>` to avoid repeats.",
    ],
  },
  {
    match: /wd_e_auth_failed|wd_e_auth_missing|unauthori[sz]ed|invalid.*token|authentication failed|forbidden/i,
    summary: "Cloudflare authentication is missing or invalid.",
    actions: [
      "Run `wd login` or `wd configure` to save credentials.",
      "Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the same account.",
      "Run `wd doctor` to validate.",
    ],
  },
  {
    match: /wd_e_config_missing|wrangler-deploy\.config\.ts/i,
    summary: "No `wrangler-deploy.config.ts` found in the current directory.",
    actions: [
      "Run `wd init` to scaffold a config from existing wrangler files.",
      "cd into a project directory that contains `wrangler-deploy.config.ts`.",
      "Or pass `--cwd <path>` to point at the project root.",
    ],
  },
  {
    match: /wd_e_network|etimedout|econnrefused|econnreset|fetch failed|network/i,
    summary: "Network failure reaching Cloudflare API or local dev server.",
    actions: [
      "Retry — this is usually transient.",
      "Check connectivity to `api.cloudflare.com` and any proxy/firewall settings.",
      "Add `--retry <n>` if the command supports it.",
    ],
  },
  {
    match: /wd_e_sandbox_blocked|agent_sandbox/i,
    summary: "Mutation blocked by sandbox mode.",
    actions: [
      "Re-run with `--dry-run` to preview without changes.",
      "Unset `AGENT_SANDBOX=1` or omit `--sandbox` to allow the mutation.",
    ],
  },
  {
    match: /wd_e_validation|usage:|required argument|missing flag|invalid value/i,
    summary: "Command-line usage error — a required flag or argument is missing.",
    actions: [
      "Run `wd <command> --help` to see required flags.",
      "Run `wd` (no args) for the top-level command list.",
    ],
  },
  {
    match: /wd_e_permission|eacces|permission denied/i,
    summary: "Filesystem permission error.",
    actions: [
      "Check ownership/permissions on the target directory.",
      "Avoid running under `sudo`; instead fix the directory permissions.",
    ],
  },
  {
    match: /wd_e_not_found|enoent/i,
    summary: "A required command, file, or resource was not found.",
    actions: [
      "Check the path exists and is in the expected directory.",
      "Run `pnpm install` and `npx wrangler --version` to ensure dependencies.",
      "Run `wd doctor` for an environment check.",
    ],
  },
];

const KNOWN_CODES: Array<{ code: string; summary: string }> = [
  { code: "WD_E_STATE_MISSING", summary: "Stage state not provisioned (run `wd apply`)" },
  { code: "WD_E_ACCOUNT_MISMATCH", summary: "API token does not belong to CLOUDFLARE_ACCOUNT_ID" },
  { code: "WD_E_AUTH_FAILED", summary: "Cloudflare authentication failed" },
  { code: "WD_E_CONFIG_MISSING", summary: "wrangler-deploy.config.ts not found" },
  { code: "WD_E_NOT_FOUND", summary: "File or command not found (ENOENT)" },
  { code: "WD_E_NETWORK", summary: "Network/connectivity failure" },
  { code: "WD_E_VALIDATION", summary: "Missing or invalid CLI flag/argument" },
  { code: "WD_E_PERMISSION", summary: "Filesystem permission denied" },
  { code: "WD_E_SANDBOX_BLOCKED", summary: "Mutation blocked by sandbox mode" },
];

export function explainIssue(query: string): ExplainResult {
  const q = query.trim();

  if (!q) {
    return {
      query: "",
      summary: "Pass an error code or message to get guided remediation.",
      actions: [
        "Usage: `wd explain <code-or-message>` (e.g. `wd explain WD_E_STATE_MISSING`).",
        "Use `wd explain --from-last-error` to explain the most recent failure.",
        ...KNOWN_CODES.map((entry) => `${entry.code} — ${entry.summary}`),
      ],
    };
  }

  for (const entry of ENTRIES) {
    if (entry.match.test(q)) {
      return { query: q, summary: entry.summary, actions: entry.actions };
    }
  }

  return {
    query: q,
    summary: "No specific signature matched — use structured diagnostics.",
    actions: [
      "Run `wd doctor` for environment/config checks.",
      "Run `wd plan --stage <name>` to validate config and stage resolution.",
      "Re-run the failing command with `--format json` and inspect the error payload.",
      "See known codes: " + KNOWN_CODES.map((entry) => entry.code).join(", "),
    ],
  };
}
