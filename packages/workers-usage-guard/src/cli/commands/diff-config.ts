import type { ParsedArgs } from "../parse.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boolFlag, requireString } from "../parse.js";

export const summary = "Compare two ACCOUNTS_JSON / accounts[] snapshots";

export const help = `
wug diff-config --before <path> --after <path> [--json]

Each file may be either:
  - An ACCOUNTS_JSON string (array of accounts), or
  - A wug.config.json (uses .accounts).

Reports added/removed accounts, added/removed workers, and threshold changes.
`;

type Worker = { scriptName: string; thresholds?: { requests?: number; cpuMs?: number; costUsd?: number } };
type Account = { accountId: string; workers: Worker[] };

function loadAccounts(path: string): Account[] {
  const raw = readFileSync(resolve(path), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed as Account[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { accounts?: Account[] }).accounts)) {
    return (parsed as { accounts: Account[] }).accounts;
  }
  throw new Error(`${path}: expected an array of accounts or { accounts: [...] }`);
}

type Diff = {
  addedAccounts: string[];
  removedAccounts: string[];
  workerChanges: Array<{
    accountId: string;
    addedScripts: string[];
    removedScripts: string[];
    thresholdChanges: Array<{ scriptName: string; before: Worker["thresholds"]; after: Worker["thresholds"] }>;
  }>;
};

export function diffAccounts(before: Account[], after: Account[]): Diff {
  const beforeMap = new Map(before.map((a) => [a.accountId, a]));
  const afterMap = new Map(after.map((a) => [a.accountId, a]));
  const addedAccounts = [...afterMap.keys()].filter((k) => !beforeMap.has(k));
  const removedAccounts = [...beforeMap.keys()].filter((k) => !afterMap.has(k));
  const workerChanges: Diff["workerChanges"] = [];
  for (const [accountId, afterAcc] of afterMap) {
    const beforeAcc = beforeMap.get(accountId);
    if (!beforeAcc) continue;
    const beforeScripts = new Map(beforeAcc.workers.map((w) => [w.scriptName, w]));
    const afterScripts = new Map(afterAcc.workers.map((w) => [w.scriptName, w]));
    const addedScripts = [...afterScripts.keys()].filter((k) => !beforeScripts.has(k));
    const removedScripts = [...beforeScripts.keys()].filter((k) => !afterScripts.has(k));
    const thresholdChanges: Diff["workerChanges"][number]["thresholdChanges"] = [];
    for (const [scriptName, afterW] of afterScripts) {
      const beforeW = beforeScripts.get(scriptName);
      if (!beforeW) continue;
      if (JSON.stringify(beforeW.thresholds ?? {}) !== JSON.stringify(afterW.thresholds ?? {})) {
        thresholdChanges.push({ scriptName, before: beforeW.thresholds, after: afterW.thresholds });
      }
    }
    if (addedScripts.length || removedScripts.length || thresholdChanges.length) {
      workerChanges.push({ accountId, addedScripts, removedScripts, thresholdChanges });
    }
  }
  return { addedAccounts, removedAccounts, workerChanges };
}

export async function run(args: ParsedArgs): Promise<number> {
  const before = loadAccounts(requireString(args.flags, "before"));
  const after = loadAccounts(requireString(args.flags, "after"));
  const diff = diffAccounts(before, after);

  if (boolFlag(args.flags, "json")) {
    console.log(JSON.stringify(diff, null, 2));
    return 0;
  }

  const lines: string[] = [];
  if (diff.addedAccounts.length) lines.push(`+ accounts: ${diff.addedAccounts.join(", ")}`);
  if (diff.removedAccounts.length) lines.push(`- accounts: ${diff.removedAccounts.join(", ")}`);
  for (const c of diff.workerChanges) {
    lines.push(`account ${c.accountId}:`);
    if (c.addedScripts.length) lines.push(`  + scripts: ${c.addedScripts.join(", ")}`);
    if (c.removedScripts.length) lines.push(`  - scripts: ${c.removedScripts.join(", ")}`);
    for (const t of c.thresholdChanges) {
      lines.push(`  ~ ${t.scriptName}: ${JSON.stringify(t.before ?? {})} → ${JSON.stringify(t.after ?? {})}`);
    }
  }
  console.log(lines.length ? lines.join("\n") : "(no changes)");
  return 0;
}
