import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { CfStageConfig } from "../types.js";
import { listD1Fixtures, listQueueFixtures, listWorkerFixtures } from "./fixtures.js";
import {
  callWorker,
  executeLocalD1,
  getD1Database,
  listQueueRoutes,
  listWorkerRoutes,
  readDevLogSnapshot,
  sendQueueMessage,
  triggerCron,
} from "./runtime.js";
import { readActiveDevState } from "./dev-runtime-state.js";
import { appendDevUiHistory, getDevUiHistoryEntry, readDevUiHistory } from "./dev-ui-history.js";
import { cliManifest } from "./cli-manifest.js";
import { listSnapshots, loadSnapshot, saveSnapshot } from "./snapshots.js";
import { loadProjectContextDetails } from "./project-context.js";
import { verifyLocal } from "./verify.js";
import { createWranglerRunner } from "./wrangler-runner.js";
import { readWranglerConfig } from "./wrangler.js";
import type { ProjectContext } from "../types.js";

export interface DevUiHandle {
  port: number;
  stop(): Promise<void>;
}

interface ActionResult {
  ok: boolean;
  title: string;
  body: string;
  assertionSummary?: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

function escapeHtml(value: string): string {
  return stripAnsi(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function defaultQueuePayload(queue: string): string {
  return JSON.stringify({ type: queue, data: { source: "dev-ui" } }, null, 2);
}

function readCronWorkers(config: CfStageConfig, rootDir: string): Array<{ workerPath: string; crons: string[] }> {
  return config.workers
    .map((workerPath) => ({
      workerPath,
      crons: readWranglerConfig(resolve(rootDir, workerPath)).triggers?.crons ?? [],
    }))
    .filter((entry) => entry.crons.length > 0);
}

function formatProjectContextValue(key: keyof ProjectContext, value: ProjectContext[keyof ProjectContext] | undefined): string {
  if (value === undefined) return "unset";
  if (key === "statePassword") return "[set]";
  if (key === "databaseUrl" && typeof value === "string") {
    try {
      const url = new URL(value);
      url.password = "";
      return url.toString();
    } catch {
      return "[set]";
    }
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return value;
}

export async function renderDevUi(
  config: CfStageConfig,
  rootDir: string,
  options?: { actionResult?: ActionResult; autoRefresh?: boolean },
): Promise<string> {
  const activeState = readActiveDevState(rootDir);
  const projectContext = loadProjectContextDetails(rootDir);
  const projectContextEntries: Array<[keyof ProjectContext, string]> = [
    ["stage", formatProjectContextValue("stage", projectContext.context.stage)],
    ["fallbackStage", formatProjectContextValue("fallbackStage", projectContext.context.fallbackStage)],
    ["basePort", formatProjectContextValue("basePort", projectContext.context.basePort)],
    ["filter", formatProjectContextValue("filter", projectContext.context.filter)],
    ["session", formatProjectContextValue("session", projectContext.context.session)],
    ["persistTo", formatProjectContextValue("persistTo", projectContext.context.persistTo)],
    ["accountId", formatProjectContextValue("accountId", projectContext.context.accountId)],
    ["databaseUrl", formatProjectContextValue("databaseUrl", projectContext.context.databaseUrl)],
    ["statePassword", formatProjectContextValue("statePassword", projectContext.context.statePassword)],
  ];
  const commandMetadata = {
    commandCount: cliManifest.commands.length,
    machineReadableDefaults: Object.entries(cliManifest.machineReadableDefaults)
      .map(([key, value]) => `${key}: ${value ? "on" : "off"}`)
      .join(", "),
    highlighted: cliManifest.commands
      .filter((command) => ["schema", "tools", "context", "dev"].includes(command.name))
      .map((command) => command.name),
  };
  const workerRoutes = await listWorkerRoutes(config, rootDir);
  const queues = listQueueRoutes(config);
  const databases = Object.keys(config.resources)
    .filter((name) => getD1Database(config, name) !== undefined)
    .map((name) => getD1Database(config, name)!);
  const logs = readDevLogSnapshot(config, rootDir).map((entry) => ({
    workerPath: entry.workerPath,
    content: entry.content.trim().split("\n").slice(-12).join("\n"),
  }));
  const cronWorkers = readCronWorkers(config, rootDir);
  const verifyPacks = Object.entries(config.verifyLocal?.packs ?? {});
  const snapshots = listSnapshots(rootDir);
  const history = readDevUiHistory(rootDir).slice(0, 8);
  const contextCard = `
    <section class="card">
      <div class="card-header">
        <h2>Project Context</h2>
        <span class="badge">${escapeHtml(projectContext.path ?? ".wdrc")}</span>
      </div>
      <p class="card-description">Resolved from the nearest <code>.wdrc</code> or <code>.wdrc.json</code> above the repo root.</p>
      <dl class="meta-list meta-list-wide">
        ${projectContextEntries.map(([key, value]) => `
          <dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>
        `).join("")}
      </dl>
      <div class="stack compact">
        <small>Use <code>wd context get</code>, <code>wd context set</code>, <code>wd context unset</code>, or <code>wd context clear</code> to edit these defaults.</small>
      </div>
    </section>
  `;

  const metadataCard = `
    <section class="card">
      <div class="card-header">
        <h2>Agent Metadata</h2>
        <span class="badge">${commandMetadata.commandCount} commands</span>
      </div>
      <p class="card-description">The UI uses the same manifest that powers <code>wd schema</code> and <code>wd tools</code>.</p>
      <dl class="meta-list meta-list-wide">
        <dt>Machine-readable defaults</dt><dd>${escapeHtml(commandMetadata.machineReadableDefaults)}</dd>
        <dt>Highlighted commands</dt><dd>${escapeHtml(commandMetadata.highlighted.join(", "))}</dd>
      </dl>
      <div class="stack compact">
        <small>Agents can introspect this package with <code>wd schema --json</code>, <code>wd tools --json</code>, and <code>wd context get stage</code>.</small>
      </div>
    </section>
  `;

  const workerCards = workerRoutes.map((route) => `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(route.workerPath)}</h2>
        <span class="badge">:${route.port}</span>
      </div>
      <div class="card-meta"><a href="${route.url}">${route.url}</a></div>
      ${route.endpoints.length > 0
        ? route.endpoints.map((endpoint) => `
          <form method="post" action="/action" class="stack">
            <input type="hidden" name="action" value="endpoint" />
            <input type="hidden" name="worker" value="${escapeHtml(route.workerPath)}" />
            <input type="hidden" name="endpoint" value="${escapeHtml(endpoint.name)}" />
            <div class="field-label">
              <span class="field-name">${escapeHtml(endpoint.name)}</span>
              <code class="method-badge">${escapeHtml(endpoint.method ?? "GET")} ${escapeHtml(endpoint.path)}</code>
            </div>
            <small>${escapeHtml(endpoint.description ?? "Named local endpoint")}</small>
            ${endpoint.method?.toUpperCase() === "POST" || endpoint.method?.toUpperCase() === "PUT" || endpoint.method?.toUpperCase() === "PATCH"
              ? `<textarea name="body" rows="4">${escapeHtml("{\n  \"source\": \"dev-ui\"\n}")}</textarea>`
              : ""}
            <button type="submit">Call endpoint</button>
          </form>
        `).join("")
        : '<p class="empty-state">No named endpoints configured.</p>'}
      ${listWorkerFixtures(config, route.workerPath).map(({ name, fixture }) => `
        <form method="post" action="/action" class="stack">
          <input type="hidden" name="action" value="worker-fixture" />
          <input type="hidden" name="fixture" value="${escapeHtml(name)}" />
          <div class="field-label">
            <span class="field-name">${escapeHtml(name)}</span>
            <span class="badge badge-secondary">fixture</span>
          </div>
          <small>${escapeHtml(fixture.description ?? "Shared worker fixture")}</small>
          ${fixture.body
            ? `<textarea name="body" rows="4">${escapeHtml(fixture.body)}</textarea>`
            : ""}
          <button type="submit" class="btn-outline">Run fixture</button>
        </form>
      `).join("")}
    </section>
  `).join("");

  const queueCards = queues.map((queue) => `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(queue.logicalName)}</h2>
      </div>
      <dl class="meta-list">
        <dt>Producers</dt><dd>${escapeHtml(queue.producers.map((producer) => `${producer.workerPath}:${producer.binding}`).join(", ") || "none")}</dd>
        <dt>Consumers</dt><dd>${escapeHtml(queue.consumers.map((consumer) => consumer.workerPath).join(", ") || "none")}</dd>
      </dl>
      <form method="post" action="/action" class="stack">
        <input type="hidden" name="action" value="queue" />
        <input type="hidden" name="queue" value="${escapeHtml(queue.logicalName)}" />
        <textarea name="payload" rows="5">${escapeHtml(defaultQueuePayload(queue.logicalName))}</textarea>
        <button type="submit">Send payload</button>
      </form>
      ${listQueueFixtures(config, queue.logicalName).map(({ name, fixture }) => `
        <form method="post" action="/action" class="stack">
          <input type="hidden" name="action" value="queue-fixture" />
          <input type="hidden" name="fixture" value="${escapeHtml(name)}" />
          <div class="field-label">
            <span class="field-name">${escapeHtml(name)}</span>
            <span class="badge badge-secondary">fixture</span>
          </div>
          <small>${escapeHtml(fixture.description ?? "Shared queue fixture")}</small>
          <textarea name="payload" rows="5">${escapeHtml(fixture.payload)}</textarea>
          <button type="submit" class="btn-outline">Send fixture</button>
        </form>
      `).join("")}
    </section>
  `).join("");

  const databaseCards = databases.map((database) => {
    const workflow = config.dev?.d1?.[database.logicalName];
    return `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(database.logicalName)}</h2>
        <span class="badge">D1</span>
      </div>
      <dl class="meta-list">
        <dt>Bindings</dt><dd>${escapeHtml(database.bindings.map((binding) => `${binding.workerPath}:${binding.binding}`).join(", "))}</dd>
      </dl>
      ${(workflow?.seedFile || workflow?.resetFile) ? `
      <div class="actions">
        ${workflow?.seedFile
          ? `<form method="post" action="/action"><input type="hidden" name="action" value="d1-seed" /><input type="hidden" name="database" value="${escapeHtml(database.logicalName)}" /><button type="submit" class="btn-outline">Run seed</button></form>`
          : ""}
        ${workflow?.resetFile
          ? `<form method="post" action="/action"><input type="hidden" name="action" value="d1-reset" /><input type="hidden" name="database" value="${escapeHtml(database.logicalName)}" /><button type="submit" class="btn-outline btn-destructive">Run reset</button></form>`
          : ""}
      </div>` : ""}
      <form method="post" action="/action" class="stack">
        <input type="hidden" name="action" value="d1-exec" />
        <input type="hidden" name="database" value="${escapeHtml(database.logicalName)}" />
        <textarea name="sql" rows="4">SELECT COUNT(*) AS count FROM sqlite_master;</textarea>
        <button type="submit">Execute SQL</button>
      </form>
      ${listD1Fixtures(config, database.logicalName).map(({ name, fixture }) => `
        <form method="post" action="/action" class="stack">
          <input type="hidden" name="action" value="d1-fixture" />
          <input type="hidden" name="fixture" value="${escapeHtml(name)}" />
          <div class="field-label">
            <span class="field-name">${escapeHtml(name)}</span>
            <span class="badge badge-secondary">fixture</span>
          </div>
          <small>${escapeHtml(fixture.description ?? "Shared D1 fixture")}</small>
          ${fixture.sql
            ? `<textarea name="sql" rows="4">${escapeHtml(fixture.sql)}</textarea>`
            : fixture.file
              ? `<input type="text" name="file" value="${escapeHtml(fixture.file)}" />`
              : ""}
          <button type="submit" class="btn-outline">Run fixture</button>
        </form>
      `).join("")}
    </section>`;
  }).join("");

  const cronCards = cronWorkers.map((entry) => `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(entry.workerPath)}</h2>
        <span class="badge badge-secondary">cron</span>
      </div>
      <dl class="meta-list">
        <dt>Schedule</dt><dd><code>${escapeHtml(entry.crons.join(", "))}</code></dd>
      </dl>
      <form method="post" action="/action" class="stack">
        <input type="hidden" name="action" value="cron" />
        <input type="hidden" name="worker" value="${escapeHtml(entry.workerPath)}" />
        <input type="text" name="cron" value="${escapeHtml(entry.crons[0] ?? "")}" />
        <button type="submit">Trigger cron</button>
      </form>
    </section>
  `).join("");

  const logCards = logs.map((entry) => `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(entry.workerPath)}</h2>
        <span class="badge badge-secondary">log</span>
      </div>
      <pre>${escapeHtml(entry.content || "No log output yet.")}</pre>
    </section>
  `).join("");

  const resultCard = options?.actionResult
    ? `<section class="card result ${options.actionResult.ok ? "ok" : "error"}">
        <div class="card-header">
          <h2>${escapeHtml(options.actionResult.title)}</h2>
          <span class="badge ${options.actionResult.ok ? "badge-ok" : "badge-error"}">${options.actionResult.ok ? "ok" : "failed"}</span>
        </div>
        ${options.actionResult.assertionSummary ? `<p class="assertion-summary">${escapeHtml(options.actionResult.assertionSummary)}</p>` : ""}
        <pre>${escapeHtml(options.actionResult.body)}</pre>
      </section>`
    : "";

  const verifyCards = verifyPacks.map(([name, pack]) => `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(name)}</h2>
        <span class="badge">${pack.checks.length} checks</span>
      </div>
      <p class="card-description">${escapeHtml(pack.description ?? "Named local verify pack")}</p>
      <form method="post" action="/action" class="stack">
        <input type="hidden" name="action" value="verify-pack" />
        <input type="hidden" name="pack" value="${escapeHtml(name)}" />
        <button type="submit">Run verify pack</button>
      </form>
    </section>
  `).join("");

  const snapshotCards = `
    <section class="card">
      <div class="card-header"><h2>Save snapshot</h2></div>
      <form method="post" action="/action" class="stack">
        <input type="hidden" name="action" value="snapshot-save" />
        <input type="text" name="name" value="local-baseline" />
        <button type="submit">Save</button>
      </form>
    </section>
    ${snapshots.map((snapshot) => `
      <section class="card">
        <div class="card-header">
          <h2>${escapeHtml(snapshot.name)}</h2>
          <span class="badge badge-secondary">snapshot</span>
        </div>
        <dl class="meta-list">
          <dt>Created</dt><dd>${escapeHtml(snapshot.createdAt)}</dd>
          <dt>Sources</dt><dd>${escapeHtml(snapshot.sources.join(", ") || "none")}</dd>
        </dl>
        <form method="post" action="/action" class="stack">
          <input type="hidden" name="action" value="snapshot-load" />
          <input type="hidden" name="name" value="${escapeHtml(snapshot.name)}" />
          <button type="submit" class="btn-outline">Load snapshot</button>
        </form>
      </section>
    `).join("")}
  `;

  const historyCards = history.map((entry) => `
    <section class="card">
      <div class="card-header">
        <h2>${escapeHtml(entry.title)}</h2>
        <span class="badge ${entry.ok ? "badge-ok" : "badge-error"}">${entry.ok ? "ok" : "failed"}</span>
      </div>
      <p class="card-timestamp">${escapeHtml(entry.createdAt)}</p>
      <pre>${escapeHtml(entry.body.split("\n").slice(0, 8).join("\n"))}</pre>
      <form method="post" action="/action" class="stack">
        <input type="hidden" name="action" value="replay-history" />
        <input type="hidden" name="id" value="${escapeHtml(entry.id)}" />
        <button type="submit" class="btn-outline">Replay</button>
      </form>
    </section>
  `).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${options?.autoRefresh === false ? "" : '<meta http-equiv="refresh" content="2" />'}
    <title>wrangler-deploy dev ui</title>
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
        --input-bg: hsl(0 0% 100%);
        --primary: hsl(240 5.9% 10%);
        --primary-fg: hsl(0 0% 98%);
        --secondary: hsl(240 4.8% 95.9%);
        --secondary-fg: hsl(240 5.9% 10%);
        --destructive: hsl(0 72.2% 50.6%);
        --destructive-fg: hsl(0 0% 98%);
        --ring: hsl(240 10% 3.9%);
        --radius: 0.375rem;
        --ok-bg: hsl(142 76% 96%);
        --ok-border: hsl(142 69% 82%);
        --ok-fg: hsl(142 71% 29%);
        --error-bg: hsl(0 86% 97%);
        --error-border: hsl(0 72% 88%);
        --error-fg: hsl(0 70% 38%);
        --badge-secondary-bg: hsl(240 4.8% 95.9%);
        --badge-secondary-fg: hsl(240 3.8% 46.1%);
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
          --input-bg: hsl(240 3.7% 9%);
          --primary: hsl(0 0% 98%);
          --primary-fg: hsl(240 5.9% 10%);
          --secondary: hsl(240 3.7% 15.9%);
          --secondary-fg: hsl(0 0% 98%);
          --destructive: hsl(0 62.8% 50.6%);
          --destructive-fg: hsl(0 0% 98%);
          --ring: hsl(240 4.9% 83.9%);
          --ok-bg: hsl(142 76% 7%);
          --ok-border: hsl(142 69% 18%);
          --ok-fg: hsl(142 71% 58%);
          --error-bg: hsl(0 72% 7%);
          --error-border: hsl(0 72% 22%);
          --error-fg: hsl(0 70% 65%);
          --badge-secondary-bg: hsl(240 3.7% 15.9%);
          --badge-secondary-fg: hsl(240 5% 64.9%);
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
        -webkit-font-smoothing: antialiased;
      }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 40px 24px 80px;
      }
      /* Header */
      .page-header {
        display: flex;
        align-items: baseline;
        gap: 16px;
        margin-bottom: 4px;
      }
      h1 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      .page-meta {
        margin: 0 0 32px;
        font-size: 12px;
        color: var(--muted-foreground);
        display: flex;
        gap: 16px;
      }
      .page-meta span { display: flex; align-items: center; gap: 4px; }
      .top-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 12px;
        margin-bottom: 8px;
      }
      /* Section headers */
      .section-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 32px 0 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--border);
      }
      .section-header h2 {
        margin: 0;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .section-count {
        font-size: 11px;
        color: var(--muted-foreground);
        font-weight: 400;
      }
      /* Grid */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 12px;
        margin-bottom: 8px;
      }
      /* Card */
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 16px;
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .card-header h2 {
        margin: 0;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .card-meta {
        font-size: 12px;
        color: var(--muted-foreground);
        margin-bottom: 12px;
      }
      .card-meta a { color: var(--muted-foreground); text-decoration: none; }
      .card-meta a:hover { color: var(--foreground); text-decoration: underline; }
      .card-description {
        margin: 0 0 12px;
        font-size: 12px;
        color: var(--muted-foreground);
      }
      .card-timestamp {
        margin: 0 0 8px;
        font-size: 11px;
        color: var(--muted-foreground);
      }
      /* Result card */
      .result.ok { background: var(--ok-bg); border-color: var(--ok-border); }
      .result.error { background: var(--error-bg); border-color: var(--error-border); }
      .result.ok .card-header h2 { color: var(--ok-fg); }
      .result.error .card-header h2 { color: var(--error-fg); }
      .assertion-summary {
        margin: 0 0 10px;
        font-size: 12px;
        font-weight: 500;
      }
      /* Meta list */
      dl.meta-list {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 2px 12px;
        margin: 0 0 12px;
        font-size: 12px;
      }
      dl.meta-list dt { color: var(--muted-foreground); white-space: nowrap; }
      dl.meta-list dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      dl.meta-list-wide dd { white-space: normal; }
      /* Badges */
      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: calc(var(--radius) - 2px);
        padding: 1px 6px;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
        background: var(--secondary);
        color: var(--secondary-fg);
        border: 1px solid var(--border);
        flex-shrink: 0;
      }
      .badge-secondary {
        background: var(--badge-secondary-bg);
        color: var(--badge-secondary-fg);
        border-color: var(--border);
        font-weight: 400;
      }
      .badge-ok {
        background: var(--ok-bg);
        color: var(--ok-fg);
        border-color: var(--ok-border);
      }
      .badge-error {
        background: var(--error-bg);
        color: var(--error-fg);
        border-color: var(--error-border);
      }
      /* Method badge */
      .method-badge {
        display: inline-flex;
        font-size: 11px;
        background: var(--muted);
        color: var(--muted-foreground);
        padding: 1px 5px;
        border-radius: 3px;
        border: 1px solid var(--border);
      }
      /* Field label row */
      .field-label {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .field-name { font-weight: 500; font-size: 13px; }
      /* Stack form layout */
      .stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
      }
      .stack.compact { margin-top: 8px; padding-top: 8px; }
      .stack:first-of-type { border-top: none; padding-top: 0; }
      /* Actions row */
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      /* Empty state */
      .empty-state {
        margin: 0;
        font-size: 12px;
        color: var(--muted-foreground);
      }
      /* Inputs */
      input[type="text"], textarea {
        width: 100%;
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.5;
        background: var(--input-bg);
        color: var(--foreground);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 8px 10px;
        resize: vertical;
        outline: none;
        transition: border-color 0.15s;
      }
      input[type="text"]:focus, textarea:focus {
        border-color: var(--ring);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent);
      }
      /* Pre / code */
      pre {
        margin: 0;
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.6;
        background: var(--muted);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 10px 12px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      code { font-family: var(--font-mono); font-size: 12px; }
      small { font-size: 12px; color: var(--muted-foreground); }
      a { color: var(--foreground); }
      /* Buttons */
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: fit-content;
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 500;
        height: 32px;
        padding: 0 14px;
        border-radius: var(--radius);
        border: 1px solid transparent;
        cursor: pointer;
        transition: opacity 0.15s, background 0.15s;
        background: var(--primary);
        color: var(--primary-fg);
      }
      button:hover { opacity: 0.88; }
      button:active { opacity: 0.76; }
      button.btn-outline {
        background: transparent;
        color: var(--foreground);
        border-color: var(--border);
      }
      button.btn-outline:hover { background: var(--muted); }
      button.btn-destructive {
        background: transparent;
        color: var(--destructive);
        border-color: var(--destructive);
      }
      button.btn-destructive:hover {
        background: var(--destructive);
        color: var(--destructive-fg);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="page-header">
        <h1>wrangler-deploy</h1>
        <span class="badge badge-secondary">dev ui</span>
      </div>
      <p class="page-meta">
        <span>mode: ${escapeHtml(activeState?.mode ?? "unknown")}</span>
        <span>updated: ${escapeHtml(activeState?.updatedAt ?? "n/a")}</span>
      </p>

      ${resultCard}

      <div class="top-grid">${contextCard}${metadataCard}</div>

      <div class="section-header"><h2>Workers</h2><span class="section-count">${workerRoutes.length}</span></div>
      <div class="grid">${workerCards || '<section class="card"><p class="empty-state">No workers configured.</p></section>'}</div>

      <div class="section-header"><h2>Cron</h2><span class="section-count">${cronWorkers.length}</span></div>
      <div class="grid">${cronCards || '<section class="card"><p class="empty-state">No cron workers configured.</p></section>'}</div>

      <div class="section-header"><h2>Queues</h2><span class="section-count">${queues.length}</span></div>
      <div class="grid">${queueCards || '<section class="card"><p class="empty-state">No queues configured.</p></section>'}</div>

      <div class="section-header"><h2>D1</h2><span class="section-count">${databases.length}</span></div>
      <div class="grid">${databaseCards || '<section class="card"><p class="empty-state">No D1 databases configured.</p></section>'}</div>

      <div class="section-header"><h2>Verify Packs</h2><span class="section-count">${verifyPacks.length}</span></div>
      <div class="grid">${verifyCards || '<section class="card"><p class="empty-state">No verify packs configured.</p></section>'}</div>

      <div class="section-header"><h2>Snapshots</h2></div>
      <div class="grid">${snapshotCards}</div>

      <div class="section-header"><h2>History</h2><span class="section-count">${history.length}</span></div>
      <div class="grid">${historyCards || '<section class="card"><p class="empty-state">No UI actions recorded yet.</p></section>'}</div>

      <div class="section-header"><h2>Logs</h2></div>
      <div class="grid">${logCards || '<section class="card"><p class="empty-state">No active runtime logs found.</p></section>'}</div>
    </main>
  </body>
</html>`;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function formToRecord(form: URLSearchParams): Record<string, string> {
  return Object.fromEntries([...form.entries()]);
}

async function runAction(config: CfStageConfig, rootDir: string, rawBody: string): Promise<ActionResult> {
  const form = new URLSearchParams(rawBody);
  const action = form.get("action");
  const wrangler = createWranglerRunner();

  try {
    if (action === "endpoint") {
      const worker = form.get("worker");
      const endpoint = form.get("endpoint");
      if (!worker || !endpoint) throw new Error("Missing worker or endpoint.");
      const body = form.get("body") || undefined;
      const result = await callWorker(config, rootDir, {
        worker,
        endpoint,
        body,
        headers: body ? { "content-type": "application/json" } : undefined,
      });
      return {
        ok: result.ok,
        title: `Endpoint ${endpoint}`,
        body: `${result.method} ${result.target.url}\n${result.status}\n\n${result.body}`,
      };
    }

    if (action === "worker-fixture") {
      const fixtureName = form.get("fixture");
      if (!fixtureName) throw new Error("Missing worker fixture.");
      const fixture = listWorkerFixtures(config).find((entry) => entry.name === fixtureName)?.fixture;
      if (!fixture) throw new Error(`Unknown worker fixture "${fixtureName}".`);
      const body = form.get("body") || fixture.body || undefined;
      const result = await callWorker(config, rootDir, {
        worker: fixture.worker,
        endpoint: fixture.endpoint,
        path: fixture.path,
        method: fixture.method,
        query: fixture.query,
        headers: body ? { ...(fixture.headers ?? {}), "content-type": (fixture.headers ?? {})["content-type"] ?? "application/json" } : fixture.headers,
        body,
      });
      return {
        ok: result.ok,
        title: `Worker fixture ${fixtureName}`,
        body: `${result.method} ${result.target.url}\n${result.status}\n\n${result.body}`,
      };
    }

    if (action === "queue") {
      const queue = form.get("queue");
      const payload = form.get("payload");
      if (!queue || !payload) throw new Error("Missing queue or payload.");
      const result = await sendQueueMessage(config, rootDir, { queue, payload });
      return {
        ok: result.ok,
        title: `Queue ${queue}`,
        body: `${result.status} ${result.target.url}\n\n${result.body}`,
      };
    }

    if (action === "queue-fixture") {
      const fixtureName = form.get("fixture");
      if (!fixtureName) throw new Error("Missing queue fixture.");
      const fixture = listQueueFixtures(config).find((entry) => entry.name === fixtureName)?.fixture;
      if (!fixture) throw new Error(`Unknown queue fixture "${fixtureName}".`);
      const payload = form.get("payload") || fixture.payload;
      const result = await sendQueueMessage(config, rootDir, {
        queue: fixture.queue,
        payload,
        worker: fixture.worker,
      });
      return {
        ok: result.ok,
        title: `Queue fixture ${fixtureName}`,
        body: `${result.status} ${result.target.url}\n\n${result.body}`,
      };
    }

    if (action === "cron") {
      const worker = form.get("worker");
      const cron = form.get("cron") || undefined;
      if (!worker) throw new Error("Missing cron worker.");
      const port = (await listWorkerRoutes(config, rootDir)).find((route) => route.workerPath === worker)?.port;
      if (!port) throw new Error(`No local port found for ${worker}.`);
      const result = await triggerCron({ port, cron });
      return {
        ok: result.ok,
        title: `Cron ${worker}`,
        body: `${result.status} ${result.url}\n\n${result.body}`,
      };
    }

    if (action === "d1-seed" || action === "d1-reset") {
      const database = form.get("database");
      if (!database) throw new Error("Missing database.");
      const file = action === "d1-seed"
        ? config.dev?.d1?.[database]?.seedFile
        : config.dev?.d1?.[database]?.resetFile;
      if (!file) throw new Error(`No file configured for ${action}.`);
      const result = executeLocalD1(config, rootDir, wrangler, { database, file });
      return {
        ok: true,
        title: `${action === "d1-seed" ? "Seed" : "Reset"} ${database}`,
        body: result.output,
      };
    }

    if (action === "d1-exec") {
      const database = form.get("database");
      const sql = form.get("sql");
      if (!database || !sql) throw new Error("Missing database or SQL.");
      const result = executeLocalD1(config, rootDir, wrangler, { database, sql });
      return {
        ok: true,
        title: `D1 ${database}`,
        body: result.output,
      };
    }

    if (action === "d1-fixture") {
      const fixtureName = form.get("fixture");
      if (!fixtureName) throw new Error("Missing D1 fixture.");
      const fixture = listD1Fixtures(config).find((entry) => entry.name === fixtureName)?.fixture;
      if (!fixture) throw new Error(`Unknown D1 fixture "${fixtureName}".`);
      const sql = form.get("sql") || fixture.sql || undefined;
      const file = form.get("file") || fixture.file || undefined;
      const result = executeLocalD1(config, rootDir, wrangler, {
        database: fixture.database,
        worker: fixture.worker,
        sql,
        file,
      });
      return {
        ok: true,
        title: `D1 fixture ${fixtureName}`,
        body: result.output,
      };
    }

    if (action === "verify-pack") {
      const pack = form.get("pack");
      if (!pack) throw new Error("Missing verify pack.");
      const result = await verifyLocal({ rootDir, config, pack, wrangler });
      return {
        ok: result.passed,
        title: `Verify pack ${pack}`,
        assertionSummary: `${result.checks.filter((check) => check.passed).length}/${result.checks.length} passed`,
        body: result.checks
          .map((check) => `${check.passed ? "+" : "x"} ${check.name}${check.details ? ` — ${check.details}` : ""}`)
          .join("\n"),
      };
    }

    if (action === "snapshot-save") {
      const name = form.get("name");
      if (!name) throw new Error("Missing snapshot name.");
      const snapshot = saveSnapshot(config, rootDir, name);
      return {
        ok: true,
        title: `Snapshot ${snapshot.name}`,
        body: `Saved snapshot with sources:\n${snapshot.sources.join("\n")}`,
      };
    }

    if (action === "snapshot-load") {
      const name = form.get("name");
      if (!name) throw new Error("Missing snapshot name.");
      const snapshot = loadSnapshot(rootDir, name);
      return {
        ok: true,
        title: `Snapshot ${snapshot.name}`,
        body: `Loaded snapshot with sources:\n${snapshot.sources.join("\n")}`,
      };
    }

    if (action === "replay-history") {
      const id = form.get("id");
      if (!id) throw new Error("Missing history entry id.");
      const entry = getDevUiHistoryEntry(rootDir, id);
      if (!entry) throw new Error(`Unknown history entry "${id}"`);
      const replayForm = new URLSearchParams(entry.form);
      replayForm.delete("action");
      return runAction(config, rootDir, new URLSearchParams({
        ...Object.fromEntries(replayForm.entries()),
        action: entry.action,
      }).toString());
    }

    throw new Error(`Unknown action "${action ?? "missing"}".`);
  } catch (error) {
    return {
      ok: false,
      title: "Action failed",
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startDevUi(
  config: CfStageConfig,
  rootDir: string,
  port: number,
): Promise<DevUiHandle> {
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        const html = await renderDevUi(config, rootDir, { autoRefresh: true });
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      if (req.method === "POST" && req.url === "/action") {
        const rawBody = await readRequestBody(req);
        const result = await runAction(config, rootDir, rawBody);
        const form = new URLSearchParams(rawBody);
        appendDevUiHistory(rootDir, {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          action: form.get("action") ?? "unknown",
          title: result.title,
          ok: result.ok,
          body: result.body,
          form: formToRecord(form),
        });
        const html = await renderDevUi(config, rootDir, { actionResult: result, autoRefresh: false });
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }

      res.statusCode = 404;
      res.end("not found");
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
          if (error) {
            reject(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
}
