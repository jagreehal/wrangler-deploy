import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProjectContext } from "../types.js";

const PROJECT_CONTEXT_FILENAMES = [".wdrc", ".wdrc.json"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProjectContext(value: unknown): ProjectContext {
  if (!isRecord(value)) return {};

  const context: ProjectContext = {};
  if (typeof value.stage === "string") context.stage = value.stage;
  if (typeof value.fallbackStage === "string") context.fallbackStage = value.fallbackStage;
  if (typeof value.basePort === "number" && Number.isFinite(value.basePort)) context.basePort = value.basePort;
  if (typeof value.filter === "string") context.filter = value.filter;
  if (typeof value.session === "boolean") context.session = value.session;
  if (typeof value.persistTo === "string") context.persistTo = value.persistTo;
  if (typeof value.accountId === "string") context.accountId = value.accountId;
  if (typeof value.databaseUrl === "string") context.databaseUrl = value.databaseUrl;
  if (typeof value.statePassword === "string") context.statePassword = value.statePassword;
  return context;
}

function readProjectContextFile(path: string): ProjectContext | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeProjectContext(parsed);
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${(error as Error).message}`, { cause: error });
  }
}

export interface ProjectContextDetails {
  path?: string;
  context: ProjectContext;
}

export function loadProjectContextDetails(startDir: string): ProjectContextDetails {
  let current = resolve(startDir);

  while (true) {
    for (const name of PROJECT_CONTEXT_FILENAMES) {
      const path = resolve(current, name);
      const context = readProjectContextFile(path);
      if (context) {
        return { path, context };
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { context: {} };
}

export function loadProjectContext(startDir: string): ProjectContext {
  return loadProjectContextDetails(startDir).context;
}

export function getProjectContextValue(
  startDir: string,
  key: keyof ProjectContext,
): unknown {
  return loadProjectContext(startDir)[key];
}

function serializeProjectContext(context: ProjectContext): string {
  return `${JSON.stringify(context, null, 2)}\n`;
}

function resolveProjectContextPath(startDir: string): string {
  const details = loadProjectContextDetails(startDir);
  return details.path ?? resolve(startDir, ".wdrc");
}

export function writeProjectContext(
  startDir: string,
  updates: Partial<ProjectContext>,
): ProjectContextDetails {
  const details = loadProjectContextDetails(startDir);
  const next: ProjectContext = { ...details.context };

  for (const [key, value] of Object.entries(updates) as Array<[keyof ProjectContext, ProjectContext[keyof ProjectContext]]>) {
    if (value === undefined) continue;
    next[key] = value as never;
  }

  const path = details.path ?? resolveProjectContextPath(startDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeProjectContext(next));
  return { path, context: next };
}

export function unsetProjectContext(
  startDir: string,
  keys: Array<keyof ProjectContext>,
): ProjectContextDetails {
  const details = loadProjectContextDetails(startDir);
  const next: ProjectContext = { ...details.context };
  for (const key of keys) {
    delete next[key];
  }

  const path = details.path ?? resolveProjectContextPath(startDir);
  mkdirSync(dirname(path), { recursive: true });
  if (Object.keys(next).length === 0) {
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
    return { path, context: {} };
  }

  writeFileSync(path, serializeProjectContext(next));
  return { path, context: next };
}

export function clearProjectContext(startDir: string): ProjectContextDetails {
  const details = loadProjectContextDetails(startDir);
  const path = details.path ?? resolveProjectContextPath(startDir);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
  return { path, context: {} };
}
