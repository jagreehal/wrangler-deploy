import type { BreachForensic } from "../../usage-guard-shared/index.js";
import type { GuardClient, GuardClientDeps } from "./client.js";

export type BreachesRunnerDeps = {
  client: Pick<GuardClient, "get">;
};

export async function runBreaches(
  args: { accountId: string; limit: number },
  deps: BreachesRunnerDeps,
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<BreachForensic[]> {
  const path = `/api/breaches?account=${encodeURIComponent(args.accountId)}&limit=${args.limit}`;
  const res = await deps.client.get<{ breaches: BreachForensic[] }>(path, clientDeps);
  return res.breaches;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsd(n: number | null): string {
  if (n === null || n === undefined) return "-";
  return `$${n.toFixed(2)}`;
}

function fmtActions(b: BreachForensic): string {
  if (!b.actionsTaken) return "-";
  const r = b.actionsTaken.removedRoutes.length;
  const d = b.actionsTaken.removedDomains.length;
  return `${fmtInt(r)}r/${fmtInt(d)}d`;
}

const COLUMNS = ["TRIGGERED_AT", "BREACH_KEY", "RULE", "ACTIONS", "EST_SAVINGS"] as const;

export function renderBreachesTable(rows: BreachForensic[]): string {
  if (rows.length === 0) return "(no data)";
  const data = rows.map((b) => [
    b.triggeredAt,
    b.breachKey,
    b.ruleId,
    fmtActions(b),
    fmtUsd(b.estimatedSavingsUsd),
  ]);
  const widths = COLUMNS.map((c, i) =>
    Math.max(c.length, ...data.map((row) => (row[i] ?? "").length))
  );
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const header = COLUMNS.map((c, i) => pad(c, widths[i]!)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = data.map((row) => row.map((v, i) => pad(v ?? "", widths[i]!)).join("  ")).join("\n");
  return `${header}\n${sep}\n${body}`;
}

export function renderBreachesJson(rows: BreachForensic[]): string {
  return JSON.stringify(rows, null, 2);
}
