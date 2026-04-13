import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface CreateStarterOptions {
  targetDir: string;
  projectName?: string;
  force?: boolean;
}

export interface CreateStarterResult {
  template: "vite";
  targetDir: string;
  projectName: string;
  files: string[];
}

function assertEmptyDir(dir: string, force: boolean): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  if (entries.length > 0 && !force) {
    throw new Error(
      `Target directory "${dir}" is not empty. Use a new directory or pass --force to overwrite files.`,
    );
  }
}

function writeFile(targetPath: string, content: string, force: boolean): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  if (existsSync(targetPath) && !force) {
    throw new Error(`File "${targetPath}" already exists. Pass --force to overwrite.`);
  }
  writeFileSync(targetPath, content);
}

function json(content: unknown): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

function kebabCase(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase() || "cloudflare-vite-app";
}

function humanTitle(input: string): string {
  return input
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

export function createViteStarter(options: CreateStarterOptions): CreateStarterResult {
  const targetDir = resolve(options.targetDir);
  const projectName = options.projectName ?? kebabCase(basename(targetDir));
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
        dev: "concurrently -n web,worker -c cyan,magenta \"pnpm dev:web\" \"pnpm dev:worker\"",
        "dev:web": "vite",
        "dev:worker": "cd workers/api && wrangler dev --port 8787",
        build: "vite build",
        preview: "vite preview",
        wd: "wd",
        "wd:plan": "wd plan --stage staging",
        "wd:apply": "wd apply --stage staging",
        "wd:deploy": "wd deploy --stage staging",
      },
      dependencies: {
        hono: "^4.12.12",
      },
      devDependencies: {
        "@cloudflare/workers-types": "^4.20260412.1",
        "@types/node": "^25.5.2",
        concurrently: "^9.2.1",
        tsx: "^4.21.0",
        typescript: "^6.0.2",
        vite: "^8.0.3",
        wrangler: "^4.80.0",
        "wrangler-deploy": "^1.2.0",
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
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: ["@cloudflare/workers-types", "node"],
      },
      include: ["wrangler-deploy.config.ts", "vite.config.ts", "src/**/*.ts", "workers/**/*.ts"],
    }),
  );

  addFile(
    "vite.config.ts",
    `import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
`,
  );

  addFile(
    "index.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${humanTitle(projectName)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  );

  addFile(
    "src/main.ts",
    `import "./style.css";

type ApiResponse = {
  ok: boolean;
  message: string;
  visits: number;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = \`
  <main class="shell">
    <p class="eyebrow">Cloudflare Vite starter</p>
    <h1>Ship a frontend and a stage-aware worker from one repo.</h1>
    <p class="lede">The Vite app talks to a worker API, and wrangler-deploy handles the stage lifecycle.</p>
    <button id="refresh">Refresh data</button>
    <pre id="output">Loading...</pre>
  </main>
\`;

const output = document.querySelector<HTMLElement>("#output");
const button = document.querySelector<HTMLButtonElement>("#refresh");

if (!output || !button) {
  throw new Error("Starter UI failed to initialize");
}

async function loadData() {
  const res = await fetch("/api");
  const data = (await res.json()) as ApiResponse;
  output.textContent = JSON.stringify(data, null, 2);
}

button.addEventListener("click", () => {
  void loadData();
});

void loadData();
`,
  );

  addFile(
    "src/style.css",
    `:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top, rgba(88, 142, 255, 0.35), transparent 35%),
    linear-gradient(180deg, #0b1020 0%, #050816 100%);
  color: #eff4ff;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  min-height: 100vh;
}

.shell {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 1rem;
  padding: 3rem;
  max-width: 44rem;
  margin: 0 auto;
}

.eyebrow {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: #8ab4ff;
  font-size: 0.75rem;
}

h1 {
  margin: 0;
  font-size: clamp(2.5rem, 7vw, 5rem);
  line-height: 0.95;
}

.lede {
  margin: 0;
  max-width: 38rem;
  color: rgba(239, 244, 255, 0.8);
  font-size: 1.05rem;
  line-height: 1.6;
}

button {
  width: fit-content;
  border: 0;
  border-radius: 999px;
  padding: 0.9rem 1.4rem;
  background: #eff4ff;
  color: #0b1020;
  font-weight: 700;
  cursor: pointer;
}

pre {
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.06);
  overflow: auto;
}
`,
  );

  addFile(
    "workers/api/src/index.ts",
    `import { Hono } from "hono";
import type { apiEnv } from "../../../wrangler-deploy.config.ts";

const app = new Hono<{ Bindings: typeof apiEnv.Env }>();

app.get("/api", async (c) => {
  const current = Number((await c.env.APP_STATE.get("visits")) ?? "0") + 1;
  await c.env.APP_STATE.put("visits", String(current));

  return c.json({
    ok: true,
    message: "Hello from Cloudflare Workers",
    visits: current,
  });
});

export default app;
`,
  );

  addFile(
    "workers/api/wrangler.jsonc",
    `{
  "name": "api",
  "main": "src/index.ts",
  "compatibility_date": "${compatibilityDate}",
  "compatibility_flags": ["nodejs_compat"],
  "dev": { "port": 8787 },
  "kv_namespaces": [
    { "binding": "APP_STATE", "id": "placeholder" }
  ]
}
`,
  );

  addFile(
    "wrangler-deploy.config.ts",
    `import { defineConfig, kv, workerEnv } from "wrangler-deploy";

const appState = kv("app-state");

export const apiEnv = workerEnv({
  APP_STATE: appState,
});

export default defineConfig({
  version: 1,
  workers: ["workers/api"],
  resources: {
    "app-state": {
      type: "kv",
      bindings: {
        "workers/api": "APP_STATE",
      },
    },
  },
  dev: {
    endpoints: {
      api: {
        worker: "workers/api",
        path: "/api",
        method: "GET",
        description: "Starter worker API endpoint",
      },
    },
  },
  stages: {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
});
`,
  );

  addFile(
    "README.md",
    `# ${humanTitle(projectName)}

Cloudflare Vite starter with a frontend, a worker API, and wrangler-deploy for stage-aware provisioning.

## Install

\`\`\`bash
pnpm install
\`\`\`

## Local dev

\`\`\`bash
pnpm dev
\`\`\`

## Stage management

\`\`\`bash
wd plan --stage staging
wd apply --stage staging
wd deploy --stage staging
\`\`\`
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
    template: "vite",
    targetDir,
    projectName,
    files,
  };
}
