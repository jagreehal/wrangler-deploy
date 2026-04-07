import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { CfStageConfig } from "../types.js";
import { resolveDevLogDir, resolveDevStatePath } from "./dev-runtime-state.js";

export interface SnapshotSource {
  relativePath: string;
  absolutePath: string;
  exists: boolean;
}

export interface SnapshotManifest {
  name: string;
  createdAt: string;
  sources: Array<{
    relativePath: string;
    kind: "file" | "directory";
  }>;
}

export interface SnapshotSummary {
  name: string;
  createdAt: string;
  sources: string[];
}

export function resolveSnapshotRoot(rootDir: string): string {
  return resolve(rootDir, ".wrangler-deploy/snapshots");
}

export function resolveSnapshotPath(rootDir: string, name: string): string {
  return resolve(resolveSnapshotRoot(rootDir), name);
}

function sanitizeSnapshotName(name: string): string {
  const value = name.trim();
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`Invalid snapshot name "${name}"`);
  }
  return value;
}

function defaultSnapshotPaths(config: CfStageConfig): string[] {
  const configured = config.dev?.snapshots?.paths ?? [];
  const sessionPersist = config.dev?.session?.persistTo;
  const defaults = [sessionPersist, ".wrangler/state", ".wrangler/state/v3"].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set([...configured, ...defaults])];
}

export function resolveSnapshotSources(
  config: CfStageConfig,
  rootDir: string,
): SnapshotSource[] {
  const sources = [
    ...defaultSnapshotPaths(config),
    relative(rootDir, resolveDevStatePath(rootDir)),
    relative(rootDir, resolveDevLogDir(rootDir)),
  ];

  return [...new Set(sources)].map((relativePath) => {
    const absolutePath = isAbsolute(relativePath) ? relativePath : resolve(rootDir, relativePath);
    return {
      relativePath: isAbsolute(relativePath) ? relative(rootDir, absolutePath) : relativePath,
      absolutePath,
      exists: existsSync(absolutePath),
    };
  });
}

export function saveSnapshot(
  config: CfStageConfig,
  rootDir: string,
  name: string,
): SnapshotSummary {
  const snapshotName = sanitizeSnapshotName(name);
  const targetDir = resolveSnapshotPath(rootDir, snapshotName);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const sources = resolveSnapshotSources(config, rootDir).filter((source) => source.exists);
  if (sources.length === 0) {
    throw new Error("No local state paths found to snapshot.");
  }

  const manifest: SnapshotManifest = {
    name: snapshotName,
    createdAt: new Date().toISOString(),
    sources: [],
  };

  for (const source of sources) {
    const destination = resolve(targetDir, source.relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source.absolutePath, destination, { recursive: true });
    manifest.sources.push({
      relativePath: source.relativePath,
      kind: statSync(source.absolutePath).isDirectory() ? "directory" : "file",
    });
  }

  writeFileSync(resolve(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return {
    name: manifest.name,
    createdAt: manifest.createdAt,
    sources: manifest.sources.map((source) => source.relativePath),
  };
}

export function loadSnapshot(rootDir: string, name: string): SnapshotSummary {
  const snapshotName = sanitizeSnapshotName(name);
  const snapshotDir = resolveSnapshotPath(rootDir, snapshotName);
  const manifestPath = resolve(snapshotDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Unknown snapshot "${snapshotName}"`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SnapshotManifest;
  for (const source of manifest.sources) {
    const from = resolve(snapshotDir, source.relativePath);
    const to = resolve(rootDir, source.relativePath);
    rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }

  return {
    name: manifest.name,
    createdAt: manifest.createdAt,
    sources: manifest.sources.map((source) => source.relativePath),
  };
}

export function listSnapshots(rootDir: string): SnapshotSummary[] {
  const snapshotRoot = resolveSnapshotRoot(rootDir);
  if (!existsSync(snapshotRoot)) return [];

  return readdirSync(snapshotRoot)
    .map((entry) => resolve(snapshotRoot, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .map((entry) => {
      const manifestPath = resolve(entry, "manifest.json");
      if (!existsSync(manifestPath)) {
        return {
          name: basename(entry),
          createdAt: "unknown",
          sources: [],
        };
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SnapshotManifest;
      return {
        name: manifest.name,
        createdAt: manifest.createdAt,
        sources: manifest.sources.map((source) => source.relativePath),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
