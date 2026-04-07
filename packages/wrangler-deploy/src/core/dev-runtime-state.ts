import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ActiveDevState {
  mode: "workers" | "session";
  ports: Record<string, number>;
  workers: string[];
  entryWorker?: string;
  entryUrl?: string;
  logFiles: Record<string, string>;
  updatedAt: string;
  pid: number;
}

export function resolveDevStatePath(rootDir: string): string {
  return resolve(rootDir, ".wrangler-deploy/dev-runtime.json");
}

export function resolveDevLogDir(rootDir: string): string {
  return resolve(rootDir, ".wrangler-deploy/dev-logs");
}

export function readActiveDevState(rootDir: string): ActiveDevState | undefined {
  const path = resolveDevStatePath(rootDir);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as ActiveDevState;
}

export function writeActiveDevState(rootDir: string, state: ActiveDevState): void {
  const path = resolveDevStatePath(rootDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function clearActiveDevState(rootDir: string): void {
  const path = resolveDevStatePath(rootDir);
  if (existsSync(path)) {
    rmSync(path);
  }
}
