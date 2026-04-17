import type { StatusRow } from "./guard/status.js";
import type { BreachForensic, UsageReport } from "usage-guard-shared";
import type { RuntimeProtectedRow } from "./guard/runtime-protected-client.js";

export type GuardPageData = {
  status: StatusRow[];
  breaches?: BreachForensic[];
  report?: UsageReport | null;
  runtimeProtected?: RuntimeProtectedRow[];
  endpointConfigured?: boolean;
  warnings?: string[];
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `$${n.toFixed(2)}`;
}

function renderUsageSection(rows: StatusRow[]): string {
  if (rows.length === 0) {
    return `<section><h2>Usage</h2><p class="empty">(no data)</p></section>`;
  }
  const body = rows
    .map(
      (r) => `
        <tr>
          <td>${esc(r.accountId)}</td>
          <td>${esc(r.scriptName)}</td>
          <td class="num">${fmtInt(r.requests)}</td>
          <td class="num">${fmtInt(r.cpuMs)}</td>
          <td class="num">${fmtUsd(r.estimatedCostUsd)}</td>
        </tr>`
    )
    .join("");
  return `
    <section>
      <h2>Usage (current billing period)</h2>
      <table>
        <thead>
          <tr><th>Account</th><th>Script</th><th>Requests</th><th>CPU ms</th><th>Est. USD</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderBreachesSection(breaches: BreachForensic[]): string {
  if (breaches.length === 0) {
    return `<section><h2>Recent breaches</h2><p class="empty">(no data)</p></section>`;
  }
  const body = breaches
    .map(
      (b) => `
        <tr>
          <td>${esc(b.triggeredAt)}</td>
          <td>${esc(b.breachKey)}</td>
          <td>${esc(b.ruleId)}</td>
          <td class="num">${fmtUsd(b.estimatedSavingsUsd)}</td>
        </tr>`
    )
    .join("");
  return `
    <section>
      <h2>Recent breaches</h2>
      <table>
        <thead>
          <tr><th>Triggered at</th><th>Breach key</th><th>Rule</th><th>Est. savings</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderReportSection(report: UsageReport | null | undefined): string {
  if (!report) return "";
  const p = report.payload;
  const top = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).slice(0, 5);
  const topRows = top
    .map(
      (w) => `
        <tr>
          <td>${esc(w.scriptName)}</td>
          <td class="num">${fmtInt(w.requests)}</td>
          <td class="num">${fmtInt(w.cpuMs)}</td>
          <td class="num">${fmtUsd(w.estimatedCostUsd)}</td>
        </tr>`
    )
    .join("");
  return `
    <section>
      <h2>Latest report</h2>
      <dl class="summary">
        <dt>Generated</dt><dd>${esc(report.generatedAt)}</dd>
        <dt>Total requests</dt><dd>${fmtInt(p.totals.requests)}</dd>
        <dt>Total CPU ms</dt><dd>${fmtInt(p.totals.cpuMs)}</dd>
        <dt>Total est. USD</dt><dd>${fmtUsd(p.totals.estimatedCostUsd)}</dd>
        <dt>Savings this month</dt><dd>${fmtUsd(p.savingsThisMonthUsd)}</dd>
      </dl>
      <h3>Top 5 by cost</h3>
      <table>
        <thead>
          <tr><th>Script</th><th>Requests</th><th>CPU ms</th><th>Est. USD</th></tr>
        </thead>
        <tbody>${topRows}</tbody>
      </table>
    </section>`;
}

function renderRuntimeProtectedSection(rows: RuntimeProtectedRow[]): string {
  if (rows.length === 0) {
    return `<section><h2>Runtime-protected</h2><p class="empty">(no data)</p></section>`;
  }
  const body = rows
    .map(
      (r) => `
        <tr>
          <td>${esc(r.accountId)}</td>
          <td>${esc(r.scriptName)}</td>
          <td>${esc(r.addedAt)}</td>
          <td>${esc(r.addedBy)}</td>
          <td>${esc(r.reason ?? "")}</td>
        </tr>`
    )
    .join("");
  return `
    <section>
      <h2>Runtime-protected scripts</h2>
      <table>
        <thead>
          <tr><th>Account</th><th>Script</th><th>Added at</th><th>Added by</th><th>Reason</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
}

function renderWarnings(data: GuardPageData): string {
  const warnings: string[] = [...(data.warnings ?? [])];
  if (data.endpointConfigured === false) {
    warnings.push(
      "Guard endpoint not configured — showing GraphQL-only data. Set guard.endpoint to enable breach history, reports, and runtime-protected overlay."
    );
  }
  if (warnings.length === 0) return "";
  const items = warnings.map((w) => `<li>${esc(w)}</li>`).join("");
  return `<div class="warnings"><ul>${items}</ul></div>`;
}

const STYLES = `
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px; color: #111; background: #fafafa; }
  h1 { margin: 0 0 16px; font-size: 20px; }
  h2 { margin: 24px 0 8px; font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { margin: 16px 0 8px; font-size: 14px; }
  section { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 16px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eee; }
  th { font-weight: 600; background: #f5f5f5; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  dl.summary { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; font-size: 13px; }
  dt { color: #666; }
  .empty { color: #888; font-style: italic; margin: 0; }
  .warnings { background: #fff7e6; border: 1px solid #ffc069; border-radius: 4px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; }
  .warnings ul { margin: 0; padding-left: 18px; }
  .nav a { color: #1a73e8; text-decoration: none; margin-right: 12px; font-size: 13px; }
  .nav { margin-bottom: 16px; }
`;

export function renderGuardPage(data: GuardPageData): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Workers Usage Guard</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Workers Usage Guard</h1>
  <div class="nav"><a href="/">← dev UI</a><a href="/guard">refresh</a></div>
  ${renderWarnings(data)}
  ${renderUsageSection(data.status)}
  ${data.breaches !== undefined ? renderBreachesSection(data.breaches) : ""}
  ${data.report !== undefined ? renderReportSection(data.report) : ""}
  ${data.runtimeProtected !== undefined ? renderRuntimeProtectedSection(data.runtimeProtected) : ""}
</body>
</html>`;
}
