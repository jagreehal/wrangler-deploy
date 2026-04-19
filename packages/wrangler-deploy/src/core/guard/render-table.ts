import type { StatusRow } from "./status.js";

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

const COLUMNS = ["ACCOUNT", "SCRIPT", "REQUESTS", "CPU_MS", "EST_USD"] as const;

export function renderStatusTable(rows: StatusRow[]): string {
  if (rows.length === 0) return "(no data)";
  const data = rows.map((r) => [
    r.accountId,
    r.scriptName,
    fmtInt(r.requests),
    fmtInt(r.cpuMs),
    fmtUsd(r.estimatedCostUsd),
  ]);
  const widths = COLUMNS.map((c, i) =>
    Math.max(c.length, ...data.map((row) => (row[i] ?? "").length))
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const headerLine = COLUMNS.map((c, i) => pad(c, widths[i]!)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = data
    .map((row) => row.map((v, i) => pad(v ?? "", widths[i]!)).join("  "))
    .join("\n");
  return `${headerLine}\n${sep}\n${body}`;
}

export function renderStatusJson(rows: StatusRow[]): string {
  return JSON.stringify(rows, null, 2);
}
