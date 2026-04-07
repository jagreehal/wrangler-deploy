import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface DevUiHistoryEntry {
  id: string;
  createdAt: string;
  action: string;
  title: string;
  ok: boolean;
  body: string;
  form: Record<string, string>;
}

function resolveHistoryPath(rootDir: string): string {
  return resolve(rootDir, ".wrangler-deploy/dev-ui-history.json");
}

export function readDevUiHistory(rootDir: string): DevUiHistoryEntry[] {
  const path = resolveHistoryPath(rootDir);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as DevUiHistoryEntry[];
}

export function writeDevUiHistory(rootDir: string, entries: DevUiHistoryEntry[]): void {
  const path = resolveHistoryPath(rootDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entries.slice(0, 30), null, 2));
}

export function appendDevUiHistory(rootDir: string, entry: DevUiHistoryEntry): void {
  const entries = readDevUiHistory(rootDir);
  writeDevUiHistory(rootDir, [entry, ...entries]);
}

export function getDevUiHistoryEntry(rootDir: string, id: string): DevUiHistoryEntry | undefined {
  return readDevUiHistory(rootDir).find((entry) => entry.id === id);
}
