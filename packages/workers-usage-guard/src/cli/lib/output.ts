function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `$${n.toFixed(2)}`;
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

export function table(columns: string[], rows: string[][]): string {
  if (rows.length === 0) return "(no data)";
  const widths = columns.map((c, i) =>
    Math.max(c.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const header = columns.map((c, i) => pad(c, widths[i]!)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) => row.map((v, i) => pad(v ?? "", widths[i]!)).join("  ")).join("\n");
  return `${header}\n${sep}\n${body}`;
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export type BreachRow = {
  triggeredAt: string;
  breachKey: string;
  ruleId: string;
  actionsTaken: { removedRoutes: unknown[]; removedDomains: unknown[] } | null;
  estimatedSavingsUsd: number | null;
};

export function renderBreaches(rows: BreachRow[]): string {
  return table(
    ["TRIGGERED_AT", "BREACH_KEY", "RULE", "ACTIONS", "EST_SAVINGS"],
    rows.map((b) => [
      b.triggeredAt,
      b.breachKey,
      b.ruleId,
      b.actionsTaken
        ? `${fmtInt(b.actionsTaken.removedRoutes.length)}r/${fmtInt(b.actionsTaken.removedDomains.length)}d`
        : "-",
      fmtUsd(b.estimatedSavingsUsd),
    ]),
  );
}

export type SnapshotRow = {
  capturedAt: string;
  scriptName: string;
  requests: number;
  cpuMs: number;
  estimatedCostUsd: number;
};

export function renderSnapshots(rows: SnapshotRow[]): string {
  return table(
    ["CAPTURED_AT", "SCRIPT", "REQUESTS", "CPU_MS", "EST_USD"],
    rows.map((r) => [
      r.capturedAt,
      r.scriptName,
      fmtInt(r.requests),
      fmtInt(r.cpuMs),
      fmtUsd(r.estimatedCostUsd),
    ]),
  );
}

export type ApprovalRow = {
  id: string;
  scriptName: string;
  breachKey: string;
  ruleId: string;
  createdAt: string;
  expiresAt: string;
  actualValue: number;
  limitValue: number;
};

export function renderApprovals(rows: ApprovalRow[]): string {
  return table(
    ["ID", "SCRIPT", "RULE", "ACTUAL", "LIMIT", "EXPIRES_AT"],
    rows.map((r) => [r.id, r.scriptName, r.ruleId, fmtInt(r.actualValue), fmtInt(r.limitValue), r.expiresAt]),
  );
}

export type RuntimeProtectedRow = {
  scriptName: string;
  addedAt: string;
  addedBy: string;
  reason: string | null;
};

export function renderRuntimeProtected(rows: RuntimeProtectedRow[]): string {
  return table(
    ["SCRIPT", "ADDED_AT", "ADDED_BY", "REASON"],
    rows.map((r) => [r.scriptName, r.addedAt, r.addedBy, r.reason ?? "-"]),
  );
}
