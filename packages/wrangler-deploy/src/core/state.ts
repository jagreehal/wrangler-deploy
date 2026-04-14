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
