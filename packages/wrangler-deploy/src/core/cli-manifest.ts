export interface CliCommandManifest {
  name: string;
  description: string;
  flags?: string[];
  subcommands?: string[];
  mutating?: boolean;
  output?: "text" | "json" | "table" | "graph";
}

export const cliManifest = {
  package: "wrangler-deploy",
  version: 1,
  machineReadableDefaults: {
    json: true,
    dryRun: true,
    fields: true,
    ndjson: true,
  },
  commands: [
    { name: "create", description: "Scaffold a new starter project.", subcommands: ["vite"], flags: ["--json", "--dir", "--name", "--force"], output: "text" },
    { name: "init", description: "Generate wrangler-deploy.config.ts from local Wrangler configs.", output: "text" },
    { name: "introspect", description: "Generate wrangler-deploy.config.ts from live Cloudflare resources.", flags: ["--dry-run", "--json"], mutating: true, output: "json" },
    { name: "plan", description: "Show resources that would be created, updated, or orphaned.", flags: ["--json"], output: "json" },
    { name: "apply", description: "Provision resources and render worker configs for a stage.", flags: ["--dry-run", "--json"], mutating: true, output: "json" },
    { name: "deploy", description: "Deploy rendered workers in dependency order.", flags: ["--dry-run", "--json", "--verify"], mutating: true, output: "json" },
    { name: "destroy", description: "Tear down a stage.", flags: ["--dry-run", "--json", "--force"], mutating: true, output: "json" },
    { name: "gc", description: "Destroy expired protected-by-TTL stages.", flags: ["--json"], mutating: true, output: "json" },
    { name: "status", description: "Inspect one stage or list available stages.", flags: ["--json"], output: "json" },
    { name: "verify", description: "Run remote or local verification checks.", flags: ["--json", "--json-report"], output: "json" },
    { name: "graph", description: "Render the resource/workers topology.", flags: ["--format json"], output: "graph" },
    { name: "impact", description: "Explain the dependency impact of a worker.", flags: ["--json"], output: "json" },
    { name: "diff", description: "Compare two stages.", flags: ["--format json"], output: "json" },
    { name: "doctor", description: "Validate wrangler and repo prerequisites.", flags: ["--json"], output: "json" },
    { name: "schema", description: "Print the CLI manifest for agents and automation.", flags: ["--json"], output: "json" },
    { name: "context", description: "Show or update resolved project defaults.", subcommands: ["get", "set", "unset", "clear"], flags: ["--json"], output: "json" },
    { name: "tools", description: "Print tool metadata derived from the command manifest.", flags: ["--json"], output: "json" },
    { name: "secrets", description: "Check, set, and sync secrets for a stage.", subcommands: ["set", "sync"], flags: ["--dry-run", "--json"], mutating: true, output: "json" },
    { name: "snapshot", description: "List, save, and load local runtime snapshots.", subcommands: ["list", "save", "load"], flags: ["--json"], output: "json" },
    { name: "fixture", description: "List shared fixtures.", subcommands: ["list"], flags: ["--json"], output: "json" },
    { name: "worker", description: "Inspect or call a worker.", subcommands: ["call", "routes"], flags: ["--json"], output: "json" },
    { name: "d1", description: "List, inspect, and execute local D1 workflows.", subcommands: ["list", "inspect", "exec", "seed", "reset"], flags: ["--json"], output: "json" },
    { name: "queue", description: "Inspect, send, replay, and tail queue workflows.", subcommands: ["list", "inspect", "send", "replay", "tail"], flags: ["--json"], output: "json" },
    { name: "ci", description: "Generate CI workflow, comments, and checks.", subcommands: ["init", "comment", "check"], flags: ["--json"], output: "json" },
    { name: "completions", description: "Generate shell completions.", output: "text" },
    { name: "help", description: "Show CLI usage or emit the manifest.", flags: ["--json"], output: "json" },
  ] satisfies CliCommandManifest[],
} as const;

export type CliManifest = typeof cliManifest;
