import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Generate AI-agent guidance files so a fresh project gets the same
 * wrangler-deploy hints we already use internally.
 *
 * One file per editor target. We deliberately keep the content short
 * and pointer-heavy: full skill content lives in the package itself
 * and the agent can fetch it on demand.
 */

export type VibeTarget =
  | "claude-code"
  | "cursor"
  | "windsurf"
  | "vscode"
  | "zed"
  | "codex"
  | "agents-md";

export interface VibeRulesOptions {
  targetDir: string;
  targets: VibeTarget[];
  force?: boolean;
}

export interface VibeRulesResult {
  files: string[];
  skipped: string[];
}

const HEADER = `# wrangler-deploy

This project uses [wrangler-deploy](https://github.com/jagreehal/wrangler-deploy)
to orchestrate Cloudflare Workers per stage. The source of truth for each
worker is its existing wrangler.jsonc — wrangler-deploy reads them, never
rewrites them.

## Common commands

\`\`\`
wd plan --stage staging       # dry-run: what would change
wd apply --stage staging      # provision resources for the stage
wd deploy --stage staging     # deploy workers
wd state tree --stage staging # inspect what's deployed
wd dev                        # local dev with all workers
\`\`\`

## Conventions

- One \`wrangler-deploy.config.ts\` at the repo root declares workers,
  resources, and stages.
- Stages default to \`$USER\` for personal stages; CI sets \`--stage prod\`
  on push to main and \`--stage pr-<number>\` for PR previews.
- Profiles for multiple Cloudflare accounts: \`wd configure --profile prod\`
  then \`wd login --profile prod\`. Use \`--profile prod\` on any command.
- Per-worker config (\`wrangler.jsonc\`) is the source of truth for runtime
  settings. Resource IDs in those files are placeholder until \`wd apply\`
  rewrites them in \`.wrangler-deploy/rendered/\`.
- Tests use \`executable-stories-vitest\`; smoke tests live under
  \`apps/smoke-test\` and need a real wrangler binary.

## Don't

- Don't use \`await import()\`. ESLint blocks it.
- Don't edit files in \`.wrangler-deploy/rendered/\` — they're regenerated.
- Don't deploy to \`prod\` from a personal stage; use CI.
`;

const TARGET_PATHS: Record<VibeTarget, string> = {
  "claude-code": ".claude/wrangler-deploy.md",
  cursor: ".cursor/rules/wrangler-deploy.md",
  windsurf: ".windsurf/rules/wrangler-deploy.md",
  vscode: ".github/copilot-instructions.md",
  zed: ".zed/rules/wrangler-deploy.md",
  codex: ".codex/wrangler-deploy.md",
  "agents-md": "AGENTS.md",
};

export function writeVibeRules(options: VibeRulesOptions): VibeRulesResult {
  const result: VibeRulesResult = { files: [], skipped: [] };
  for (const target of options.targets) {
    const relPath = TARGET_PATHS[target];
    const fullPath = resolve(options.targetDir, relPath);
    if (existsSync(fullPath) && !options.force) {
      result.skipped.push(relPath);
      continue;
    }
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, HEADER, "utf-8");
    result.files.push(relPath);
  }
  return result;
}

export function parseVibeTargets(value: string): VibeTarget[] {
  if (!value) return [];
  if (value === "all") {
    return Object.keys(TARGET_PATHS) as VibeTarget[];
  }
  const targets = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as VibeTarget[];
  for (const target of targets) {
    if (!(target in TARGET_PATHS)) {
      throw new Error(
        `Unknown vibe target "${target}". Available: ${Object.keys(TARGET_PATHS).join(", ")}, all`,
      );
    }
  }
  return targets;
}

export function listVibeTargets(): VibeTarget[] {
  return Object.keys(TARGET_PATHS) as VibeTarget[];
}
