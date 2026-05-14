import { createServer } from "node:http";
import type { CfStageConfig, StageState, ResourceState, WorkerState } from "../types.js";
import { resourceId } from "../types.js";
import type { StateProvider } from "./state.js";
import { resolveAccountId } from "./auth.js";

export interface DeployedUiHandle {
  port: number;
  stop(): Promise<void>;
}

type StageStateEntry = { name: string; state: StageState };

export async function startDeployedUi(
  _config: CfStageConfig,
  rootDir: string,
  stateProvider: StateProvider,
  stage: string | undefined,
  port: number,
): Promise<DeployedUiHandle> {
  const server = createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const path = reqUrl.pathname === "/" ? "" : reqUrl.pathname;
      const selectedStage = path.replace(/^\//, "") || stage;
      const stages = await stateProvider.list();

      const accountId = resolveAccountId(rootDir);
      const stageStates: StageStateEntry[] = [];
      for (const name of (selectedStage ? [selectedStage] : stages)) {
        const s = await stateProvider.read(name);
        if (s) stageStates.push({ name, state: s as StageState });
      }

      const body = renderDeployedPage(stageStates, stages, accountId, selectedStage);

      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(body);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  return {
    port,
    stop: async () => {
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => {
          if (error) { reject(error); return; }
          resolveClose();
        });
      });
    },
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderDeployedPage(
  stageStates: StageStateEntry[],
  allStages: string[],
  accountId: string,
  currentStage: string | undefined,
): string {
  const stageLinks = allStages.map((s) => {
    const active = !currentStage || s === currentStage;
    return `<a href="/${escapeHtml(s)}" class="${active ? "active" : ""}">${escapeHtml(s)}</a>`;
  }).join("\n          ");

  const stageCards = stageStates.map(({ name, state }) => {
    const workerEntries = Object.entries(state.workers) as Array<[string, WorkerState]>;
    const workerCards = workerEntries.map(([path, w]) => {
      const ws = w as WorkerState & { versionId?: string };
      const version = ws.versionId;
      const dashUrl = ws.name ? `https://dash.cloudflare.com/${accountId}/workers/services/view/${ws.name}` : "";
      return `
        <section class="card">
          <div class="card-header">
            <h2>${escapeHtml(ws.name)}</h2>
            <span class="badge badge-ok">deployed</span>
          </div>
          <dl class="meta-list">
            <dt>Path</dt><dd>${escapeHtml(path)}</dd>
            <dt>Status</dt><dd>deployed</dd>
            ${version ? `<dt>Version</dt><dd><code>${escapeHtml(version)}</code></dd>` : ""}
            ${ws.url ? `<dt>URL</dt><dd><a href="${escapeHtml(ws.url)}" target="_blank">${escapeHtml(ws.url)}</a></dd>` : ""}
            <dt>Dashboard</dt><dd><a href="${escapeHtml(dashUrl)}" target="_blank">Open dashboard ↗</a></dd>
          </dl>
        </section>`;
    }).join("");

    const resourceEntries = Object.entries(state.resources) as Array<[string, ResourceState]>;
    const resourceCards = resourceEntries.map(([logicalName, r]) => {
      const rs = r as ResourceState;
      const lifecycleStatus = rs.lifecycleStatus === "created" || rs.lifecycleStatus === "updated" ? "active" : rs.lifecycleStatus;
      return `
        <section class="card">
          <div class="card-header">
            <h2>${escapeHtml(logicalName)}</h2>
            <span class="badge badge-${lifecycleStatus === "active" ? "ok" : "secondary"}">${escapeHtml(rs.type)}</span>
          </div>
          <dl class="meta-list">
            <dt>Name</dt><dd>${escapeHtml(rs.props?.name ?? logicalName)}</dd>
            <dt>Status</dt><dd>${escapeHtml(lifecycleStatus)}</dd>
            ${resourceId(rs) ? `<dt>ID</dt><dd><code>${escapeHtml(resourceId(rs)!)}</code></dd>` : ""}
          </dl>
        </section>`;
    }).join("");

    return `
      <div class="stage-section">
        <h2 class="stage-title">${escapeHtml(name)}</h2>
        <p class="stage-meta">Created: ${escapeHtml(state.createdAt)}  |  Updated: ${escapeHtml(state.updatedAt)}</p>
        ${workerCards ? `<div class="section-header"><h3>Workers</h3><span class="section-count">${Object.keys(state.workers).length}</span></div><div class="grid">${workerCards}</div>` : ""}
        ${resourceCards ? `<div class="section-header"><h3>Resources</h3><span class="section-count">${Object.keys(state.resources).length}</span></div><div class="grid">${resourceCards}</div>` : ""}
      </div>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="10" />
  <title>wrangler-deploy — deployed status</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --font-mono: "JetBrains Mono", ui-monospace, monospace;
      --background: hsl(0 0% 100%);
      --foreground: hsl(240 10% 3.9%);
      --card: hsl(0 0% 100%);
      --card-foreground: hsl(240 10% 3.9%);
      --muted: hsl(240 4.8% 95.9%);
      --muted-foreground: hsl(240 3.8% 46.1%);
      --border: hsl(240 5.9% 90%);
      --primary: hsl(240 5.9% 10%);
      --primary-fg: hsl(0 0% 98%);
      --radius: 0.375rem;
      --ok-bg: hsl(142 76% 96%);
      --ok-border: hsl(142 69% 82%);
      --ok-fg: hsl(142 71% 29%);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: hsl(240 10% 3.9%);
        --foreground: hsl(0 0% 98%);
        --card: hsl(240 10% 5.5%);
        --card-foreground: hsl(0 0% 98%);
        --muted: hsl(240 3.7% 15.9%);
        --muted-foreground: hsl(240 5% 64.9%);
        --border: hsl(240 3.7% 15.9%);
        --primary: hsl(0 0% 98%);
        --primary-fg: hsl(240 5.9% 10%);
        --ok-bg: hsl(142 76% 7%);
        --ok-border: hsl(142 69% 18%);
        --ok-fg: hsl(142 71% 58%);
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.6;
      background: var(--background);
      color: var(--foreground);
    }
    main { max-width: 1280px; margin: 0 auto; padding: 40px 24px 80px; }
    h1 { margin: 0; font-size: 1rem; font-weight: 600; }
    .page-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 4px; }
    .page-meta { margin: 0 0 12px; font-size: 12px; color: var(--muted-foreground); display: flex; gap: 16px; flex-wrap: wrap; }
    .stage-nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .stage-nav a {
      display: inline-flex; align-items: center; padding: 4px 12px;
      border-radius: var(--radius); font-size: 12px; font-weight: 500;
      background: var(--muted); color: var(--foreground); text-decoration: none;
    }
    .stage-nav a.active { background: var(--primary); color: var(--primary-fg); }
    .stage-nav a:hover { opacity: 0.85; }
    .stage-title { font-size: 14px; font-weight: 500; margin: 0 0 4px; }
    .stage-meta { font-size: 11px; color: var(--muted-foreground); margin: 0 0 16px; }
    .stage-section { margin-bottom: 32px; }
    .section-header { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; }
    .section-header h3 { margin: 0; font-size: 12px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-foreground); }
    .section-count { font-size: 11px; color: var(--muted-foreground); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
    .card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 16px;
    }
    .card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .card-header h2 { margin: 0; font-size: 13px; font-weight: 500; }
    .badge {
      display: inline-flex; align-items: center; border-radius: calc(var(--radius) - 2px);
      padding: 1px 6px; font-size: 11px; font-weight: 500; white-space: nowrap;
      background: var(--muted); color: var(--muted-foreground); border: 1px solid var(--border);
    }
    .badge-ok { background: var(--ok-bg); color: var(--ok-fg); border-color: var(--ok-border); }
    .badge-secondary { opacity: 0.7; }
    dl.meta-list {
      display: grid; grid-template-columns: auto 1fr; gap: 2px 12px;
      margin: 0; font-size: 12px;
    }
    dl.meta-list dt { color: var(--muted-foreground); white-space: nowrap; }
    dl.meta-list dd { margin: 0; overflow: hidden; text-overflow: ellipsis; }
    a { color: var(--foreground); }
    code { font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <div class="page-header">
      <h1>wrangler-deploy</h1>
      <span class="badge">deployed status</span>
    </div>
    <p class="page-meta">
      <span>stages: ${allStages.length}</span>
      <span>auto-refresh: 10s</span>
    </p>
    <div class="stage-nav">
      <a href="/" class="${!currentStage ? "active" : ""}">All</a>
      ${stageLinks}
    </div>
    ${stageCards || '<p style="color: var(--muted-foreground)">No stage state found.</p>'}
  </main>
</body>
</html>`;
}
