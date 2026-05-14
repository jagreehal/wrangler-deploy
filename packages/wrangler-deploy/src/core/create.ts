import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { AgentErrors } from "./cli-output.js";

/**
 * Templates that ship inline with the CLI. Currently only the bare
 * hello-world Worker — everything else (vite, etc.) lives in the repo's
 * `templates/` directory and is fetched at scaffold time via
 * `core/scaffold.ts`. See templates/README.md.
 */
export type StarterTemplate = "hello";

export interface CreateStarterOptions {
  targetDir: string;
  projectName?: string;
  force?: boolean;
}

export interface CreateStarterResult {
  template: StarterTemplate;
  targetDir: string;
  projectName: string;
  files: string[];
}

function assertEmptyDir(dir: string, force: boolean): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  if (entries.length > 0 && !force) {
    throw AgentErrors.validation(
      `Target directory "${dir}" is not empty. Use a new directory or pass --force to overwrite files.`,
      "Use a new directory, or pass --force to overwrite.",
      { flag: "--force" },
    );
  }
}

function writeFile(targetPath: string, content: string, force: boolean): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  if (existsSync(targetPath) && !force) {
    throw AgentErrors.validation(`File "${targetPath}" already exists. Pass --force to overwrite.`, "Pass --force to overwrite the existing file.", { flag: "--force" });
  }
  writeFileSync(targetPath, content);
}

function json(content: unknown): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

function kebabCase(input: string, fallback = "my-worker"): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase() || fallback;
}

function humanTitle(input: string): string {
  return input
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Bare hello-world Worker template. No frontend, no KV, no Hono — the
 * smallest possible "this works" scaffold for a Cloudflare newcomer.
 *
 * Local dev runs against `wrangler dev` directly, no `wd apply` needed first.
 * `wd deploy --stage <name>` is the second-step ramp once they've seen
 * localhost working.
 */
export function createHelloStarter(options: CreateStarterOptions): CreateStarterResult {
  const targetDir = resolve(options.targetDir);
  const projectName = options.projectName ?? kebabCase(basename(targetDir), "hello-worker");
  const compatibilityDate = new Date().toISOString().slice(0, 10);

  assertEmptyDir(targetDir, !!options.force);
  mkdirSync(targetDir, { recursive: true });

  const files: string[] = [];
  const addFile = (relativePath: string, content: string) => {
    const filePath = join(targetDir, relativePath);
    writeFile(filePath, content, !!options.force);
    files.push(relativePath);
  };

  addFile(
    "package.json",
    json({
      name: projectName,
      private: true,
      type: "module",
      scripts: {
        // Day-1 commands: dev + deploy go straight through Wrangler so the
        // hello-world flow works without any wrangler-deploy stage concepts.
        dev: "wrangler dev",
        deploy: "wrangler deploy",
        // Day-2 commands: once you've added resources to wrangler-deploy.config.ts,
        // these create stage-suffixed environments. See:
        //   https://wrangler-deploy.dev/wrangler-deploy/getting-started/quick-start/
        plan: "wd plan",
        apply: "wd apply",
        status: "wd status",
        "deploy:stage": "wd deploy",
      },
      devDependencies: {
        "@cloudflare/workers-types": "^4.20260412.1",
        typescript: "^6.0.2",
        wrangler: "^4.80.0",
        "wrangler-deploy": "^1.4.0",
      },
    }),
  );

  addFile(
    "tsconfig.json",
    json({
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        skipLibCheck: true,
        lib: ["ES2022"],
        types: ["@cloudflare/workers-types"],
      },
      include: ["wrangler-deploy.config.ts", "src/**/*.ts"],
    }),
  );

  addFile(
    "src/index.ts",
    `export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return Response.json({
      message: "Hello from Cloudflare Workers!",
      path: url.pathname,
      now: new Date().toISOString(),
    });
  },
};
`,
  );

  addFile(
    "wrangler.jsonc",
    `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${projectName}",
  "main": "src/index.ts",
  "compatibility_date": "${compatibilityDate}",
  "compatibility_flags": ["nodejs_compat"]
}
`,
  );

  addFile(
    "wrangler-deploy.config.ts",
    `import { defineConfig } from "wrangler-deploy";

// Adding resources later? Declare them here and they'll be created per-stage
// when you run \`wd apply --stage <name>\`. See:
//   https://wrangler-deploy.dev/wrangler-deploy/resources/
export default defineConfig({
  version: 1,
  workers: ["."],
  resources: {},
  stages: {
    production: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
});
`,
  );

  addFile(
    "README.md",
    `# ${humanTitle(projectName)}

A Cloudflare Worker scaffolded with [\`wrangler-deploy\`](https://wrangler-deploy.dev/).

## Local dev

\`\`\`bash
pnpm dev
\`\`\`

Open <http://localhost:8787> — you should see JSON.

## Deploy

When you're ready to put it on the edge:

\`\`\`bash
pnpm run deploy
# or: npm run deploy / yarn run deploy / bun run deploy
\`\`\`

Note: \`pnpm deploy\` (without \`run\`) is a built-in pnpm command that targets workspaces, so always use \`pnpm run deploy\` for this script.

The first deploy will prompt you to log in to Cloudflare if you haven't yet.

## What's next

- Edit \`src/index.ts\` — \`wrangler dev\` hot-reloads on save.
- Add resources (KV, D1, queues) in \`wrangler-deploy.config.ts\`.
- Once you have resources, swap to staged deploys: \`pnpm run apply\` + \`pnpm run deploy:stage --stage <name>\`.
- Run \`wd help\` for the full command list.
`,
  );

  addFile(
    ".gitignore",
    `node_modules
.wrangler
.wrangler-deploy
dist
`,
  );

  return {
    template: "hello",
    targetDir,
    projectName,
    files,
  };
}
