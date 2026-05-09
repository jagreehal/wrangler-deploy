import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import type { StageState, StateConfig } from "../types.js";
import { getWranglerEnv, resolveAccountId } from "./auth.js";
import { encryptState, decryptState } from "./crypto.js";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface StateProvider {
  read(stage: string): Promise<StageState | null>;
  write(stage: string, state: StageState): Promise<void>;
  delete(stage: string): Promise<void>;
  list(): Promise<string[]>;
}

export function resolveStateProvider(rootDir: string, stateConfig?: StateConfig, password?: string): StateProvider {
  if (!stateConfig || stateConfig.backend === "local") {
    return new LocalStateProvider(rootDir, password);
  }

  if (stateConfig.backend === "kv") {
    return new KvStateProvider(rootDir, stateConfig.namespaceId!, stateConfig.keyPrefix, password);
  }

  if (stateConfig.backend === "d1") {
    if (!stateConfig.databaseId) {
      throw new Error("state.databaseId is required when backend: \"d1\"");
    }
    return new D1StateProvider(rootDir, stateConfig.databaseId, stateConfig.tableName, password);
  }

  if (stateConfig.backend === "r2") {
    if (!stateConfig.bucketName) {
      throw new Error("state.bucketName is required when backend: \"r2\"");
    }
    return new R2StateProvider(rootDir, stateConfig.bucketName, stateConfig.keyPrefix, password);
  }

  return new LocalStateProvider(rootDir, password);
}

export async function loadState(
  rootDir: string,
  stage: string,
  stateConfig?: StateConfig,
  password?: string,
): Promise<StageState | null> {
  const provider = resolveStateProvider(rootDir, stateConfig, password);
  return provider.read(stage);
}

export class KvStateProvider implements StateProvider {
  private accountId: string;
  private apiToken: string;
  private namespaceId: string;
  private prefix: string;
  private password?: string;

  constructor(rootDir: string, namespaceId: string, keyPrefix: string = "wrangler-deploy/", password?: string) {
    this.prefix = keyPrefix;
    this.password = password;
    const env = getWranglerEnv(rootDir);
    this.apiToken = env.CLOUDFLARE_API_TOKEN || "";
    if (!this.apiToken) {
      throw new Error("CLOUDFLARE_API_TOKEN is required for remote state");
    }
    this.accountId = resolveAccountId(rootDir);
    this.namespaceId = namespaceId;
  }

  private async kvGet(key: string): Promise<unknown> {
    const url = `${CF_API_BASE}/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`KV get failed: ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async kvPut(key: string, value: string): Promise<void> {
    const url = `${CF_API_BASE}/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "text/plain" },
      body: value,
    });
    if (!res.ok) {
      throw new Error(`KV put failed: ${res.status} ${await res.text()}`);
    }
  }

  private async kvDelete(key: string): Promise<void> {
    const url = `${CF_API_BASE}/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`KV delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async read(stage: string): Promise<StageState | null> {
    const key = `${this.prefix}${stage}`;
    const value = await this.kvGet(key);
    if (!value) return null;
    const state = value as StageState;
    return this.password ? decryptState(state, this.password) : state;
  }

  async write(stage: string, state: StageState): Promise<void> {
    const key = `${this.prefix}${stage}`;
    const toStore = this.password ? await encryptState(state, this.password) : state;
    await this.kvPut(key, JSON.stringify(toStore));
  }

  async delete(stage: string): Promise<void> {
    const key = `${this.prefix}${stage}`;
    await this.kvDelete(key);
  }

  async list(): Promise<string[]> {
    const url = `${CF_API_BASE}/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/keys?prefix=${encodeURIComponent(this.prefix)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`KV list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { result: Array<{ name: string }> };
    return data.result.map((k: { name: string }) => k.name.replace(this.prefix, ""));
  }
}

/**
 * Stores state in a Cloudflare D1 database. Useful when KV's eventual
 * consistency or 25 MB value limit becomes a problem — D1 gives you SQL
 * for ad-hoc inspection and arbitrary state size.
 *
 * Schema is bootstrapped lazily on first write:
 *   CREATE TABLE IF NOT EXISTS <tableName> (
 *     stage TEXT PRIMARY KEY,
 *     state TEXT NOT NULL,
 *     updated_at INTEGER NOT NULL
 *   )
 */
export class D1StateProvider implements StateProvider {
  private accountId: string;
  private apiToken: string;
  private databaseId: string;
  private tableName: string;
  private password?: string;
  private schemaEnsured = false;

  constructor(
    rootDir: string,
    databaseId: string,
    tableName: string = "stage_state",
    password?: string,
  ) {
    this.password = password;
    const env = getWranglerEnv(rootDir);
    this.apiToken = env.CLOUDFLARE_API_TOKEN || "";
    if (!this.apiToken) {
      throw new Error("CLOUDFLARE_API_TOKEN is required for remote state");
    }
    this.accountId = resolveAccountId(rootDir);
    this.databaseId = databaseId;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
      throw new Error(`state.tableName must match [a-zA-Z_][a-zA-Z0-9_]* (got "${tableName}")`);
    }
    this.tableName = tableName;
  }

  private async d1Query<T = unknown>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<Array<{ results: T[] }>> {
    const url = `${CF_API_BASE}/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    if (!res.ok) {
      throw new Error(`D1 query failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      success: boolean;
      result: Array<{ results: T[] }>;
      errors?: Array<{ message: string }>;
    };
    if (!body.success) {
      const message = body.errors?.map((e) => e.message).join(", ") ?? "unknown D1 error";
      throw new Error(`D1 query failed: ${message}`);
    }
    return body.result;
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;
    await this.d1Query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
        stage TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    this.schemaEnsured = true;
  }

  async read(stage: string): Promise<StageState | null> {
    await this.ensureSchema();
    const result = await this.d1Query<{ state: string }>(
      `SELECT state FROM ${this.tableName} WHERE stage = ?`,
      [stage],
    );
    const row = result[0]?.results[0];
    if (!row?.state) return null;
    const parsed = JSON.parse(row.state) as StageState;
    return this.password ? decryptState(parsed, this.password) : parsed;
  }

  async write(stage: string, state: StageState): Promise<void> {
    await this.ensureSchema();
    const toStore = this.password ? await encryptState(state, this.password) : state;
    await this.d1Query(
      `INSERT INTO ${this.tableName} (stage, state, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(stage) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      [stage, JSON.stringify(toStore), Date.now()],
    );
  }

  async delete(stage: string): Promise<void> {
    await this.ensureSchema();
    await this.d1Query(
      `DELETE FROM ${this.tableName} WHERE stage = ?`,
      [stage],
    );
  }

  async list(): Promise<string[]> {
    await this.ensureSchema();
    const result = await this.d1Query<{ stage: string }>(
      `SELECT stage FROM ${this.tableName} ORDER BY stage`,
    );
    return result[0]?.results.map((row) => row.stage) ?? [];
  }
}

/**
 * Stores state as JSON objects in a Cloudflare R2 bucket. A third option
 * alongside KV and D1 — useful when you've already standardised on R2
 * for everything else and want one less service to think about.
 *
 * Object key layout: `<prefix><stage>` (e.g. `wrangler-deploy/staging`).
 * Listing uses the bucket's prefix-list API to enumerate stages.
 *
 * Uses the Cloudflare REST API rather than the S3-compatible endpoint so
 * we can authenticate with the same Bearer token that KV and D1 use.
 */
export class R2StateProvider implements StateProvider {
  private accountId: string;
  private apiToken: string;
  private bucketName: string;
  private prefix: string;
  private password?: string;

  constructor(
    rootDir: string,
    bucketName: string,
    keyPrefix: string = "wrangler-deploy/",
    password?: string,
  ) {
    this.password = password;
    const env = getWranglerEnv(rootDir);
    this.apiToken = env.CLOUDFLARE_API_TOKEN || "";
    if (!this.apiToken) {
      throw new Error("CLOUDFLARE_API_TOKEN is required for remote state");
    }
    this.accountId = resolveAccountId(rootDir);
    this.bucketName = bucketName;
    this.prefix = keyPrefix;
  }

  private url(key: string): string {
    return `${CF_API_BASE}/accounts/${this.accountId}/r2/buckets/${this.bucketName}/objects/${encodeURIComponent(key)}`;
  }

  async read(stage: string): Promise<StageState | null> {
    const res = await fetch(this.url(`${this.prefix}${stage}`), {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`R2 get failed: ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    const parsed = JSON.parse(text) as StageState;
    return this.password ? decryptState(parsed, this.password) : parsed;
  }

  async write(stage: string, state: StageState): Promise<void> {
    const toStore = this.password ? await encryptState(state, this.password) : state;
    const res = await fetch(this.url(`${this.prefix}${stage}`), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toStore),
    });
    if (!res.ok) {
      throw new Error(`R2 put failed: ${res.status} ${await res.text()}`);
    }
  }

  async delete(stage: string): Promise<void> {
    const res = await fetch(this.url(`${this.prefix}${stage}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`R2 delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async list(): Promise<string[]> {
    const url = `${CF_API_BASE}/accounts/${this.accountId}/r2/buckets/${this.bucketName}/objects?prefix=${encodeURIComponent(this.prefix)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`R2 list failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { result?: { objects?: Array<{ key: string }> } };
    const keys = body.result?.objects?.map((o) => o.key) ?? [];
    return keys
      .filter((key) => key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length));
  }
}

export class LocalStateProvider implements StateProvider {
  constructor(private rootDir: string, private password?: string) {}

  async read(stage: string): Promise<StageState | null> {
    const path = statePath(this.rootDir, stage);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const state = JSON.parse(raw) as StageState;
    return this.password ? decryptState(state, this.password) : state;
  }

  async write(stage: string, state: StageState): Promise<void> {
    const path = statePath(this.rootDir, stage);
    mkdirSync(dirname(path), { recursive: true });
    const toStore = this.password ? await encryptState(state, this.password) : state;
    writeFileSync(path, JSON.stringify(toStore, null, 2) + "\n");
  }

  async delete(stage: string): Promise<void> {
    const dir = join(this.rootDir, ".wrangler-deploy", stage);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }

  async list(): Promise<string[]> {
    const cfStageDir = join(this.rootDir, ".wrangler-deploy");
    if (!existsSync(cfStageDir)) return [];
    return readdirSync(cfStageDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => existsSync(join(cfStageDir, d.name, "state.json")))
      .map((d) => d.name);
  }
}

export function statePath(rootDir: string, stage: string): string {
  return join(rootDir, ".wrangler-deploy", stage, "state.json");
}

export function readState(rootDir: string, stage: string): StageState | null {
  const path = statePath(rootDir, stage);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

export function writeState(rootDir: string, stage: string, state: StageState): void {
  const path = statePath(rootDir, stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

export function deleteState(rootDir: string, stage: string): void {
  const dir = join(rootDir, ".wrangler-deploy", stage);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

export function listStages(rootDir: string): string[] {
  const cfStageDir = join(rootDir, ".wrangler-deploy");
  if (!existsSync(cfStageDir)) return [];

  return readdirSync(cfStageDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => existsSync(join(cfStageDir, d.name, "state.json")))
    .map((d) => d.name);
}
