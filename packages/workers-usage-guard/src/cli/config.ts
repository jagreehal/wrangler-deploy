import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type WugThresholds = {
  requests?: number;
  cpuMs?: number;
  costUsd?: number;
};

export type WugWorker = {
  scriptName: string;
  thresholds?: WugThresholds;
  presets?: Array<"cost-runaway" | "request-flood" | "cpu-spike">;
  protected?: boolean;
  forecast?: boolean;
  forecastLookaheadSeconds?: number;
};

export type WugAccount = {
  accountId: string;
  billingCycleDay: number;
  workers: WugWorker[];
  globalProtected?: string[];
};

export type WugNotificationChannel =
  | { type: "discord"; webhookUrlSecret: string; dedupeWindowSeconds?: number }
  | { type: "slack"; webhookUrlSecret: string; dedupeWindowSeconds?: number }
  | { type: "webhook"; urlSecret: string; dedupeWindowSeconds?: number };

export type WugConfig = {
  endpoint?: string;
  databaseId?: string;
  databaseName?: string;
  scriptName?: string;
  accounts?: WugAccount[];
  notifications?: { channels: WugNotificationChannel[] };
  vars?: {
    requestThreshold?: number;
    cpuTimeThresholdMs?: number;
    overageCooldownSeconds?: number;
    overageGraceSeconds?: number;
    guardScriptName?: string;
  };
};

export const DEFAULT_CONFIG_FILE = "wug.config.json";
export const DEFAULT_DATABASE_NAME = "workers-usage-guard";
export const DEFAULT_SCRIPT_NAME = "workers-usage-guard";
export const SIGNING_KEY_ENV = "GUARD_API_SIGNING_KEY";
export const ENDPOINT_ENV = "WUG_ENDPOINT";
export const ACCOUNT_ENV = "WUG_ACCOUNT";

export function configPath(cwd: string, override?: string): string {
  return resolve(cwd, override ?? DEFAULT_CONFIG_FILE);
}

export function loadConfig(args: { cwd: string; file?: string }): WugConfig {
  const path = configPath(args.cwd, args.file);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid ${args.file ?? DEFAULT_CONFIG_FILE}: expected an object`);
  }
  return parsed as WugConfig;
}

export function saveConfig(args: { cwd: string; file?: string; config: WugConfig }): string {
  const path = configPath(args.cwd, args.file);
  writeFileSync(path, JSON.stringify(args.config, null, 2) + "\n", "utf-8");
  return path;
}

export type ResolvedEndpoint = {
  endpoint: string;
  signingKey: string;
};

export function resolveEndpoint(args: {
  config: WugConfig;
  flags: Record<string, string | boolean>;
  env: NodeJS.ProcessEnv;
}): ResolvedEndpoint {
  const endpoint = pickString(args.flags, "endpoint") ?? args.env[ENDPOINT_ENV] ?? args.config.endpoint;
  if (!endpoint) {
    throw new Error(
      `endpoint is required. Set in wug.config.json, pass --endpoint, or export ${ENDPOINT_ENV}.`,
    );
  }
  const signingKey = pickString(args.flags, "signing-key") ?? args.env[SIGNING_KEY_ENV];
  if (!signingKey) {
    throw new Error(
      `signing key is required. Pass --signing-key or export ${SIGNING_KEY_ENV}. Never store the key in wug.config.json.`,
    );
  }
  return { endpoint, signingKey };
}

export function resolveAccount(args: {
  config: WugConfig;
  flags: Record<string, string | boolean>;
  env: NodeJS.ProcessEnv;
}): string {
  const account =
    pickString(args.flags, "account") ??
    args.env[ACCOUNT_ENV] ??
    args.config.accounts?.[0]?.accountId;
  if (!account) {
    throw new Error(
      `account id is required. Pass --account, export ${ACCOUNT_ENV}, or add an entry to accounts[] in wug.config.json.`,
    );
  }
  return account;
}

function pickString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function buildAccountsJson(config: WugConfig): string {
  const accounts = (config.accounts ?? []).map((a) => ({
    accountId: a.accountId,
    billingCycleDay: a.billingCycleDay,
    workers: a.workers,
    globalProtected: a.globalProtected ?? [],
  }));
  return JSON.stringify(accounts);
}

export function buildNotificationsJson(config: WugConfig): string {
  return JSON.stringify({ channels: config.notifications?.channels ?? [] });
}

export function listNotificationSecrets(config: WugConfig): string[] {
  const channels = config.notifications?.channels ?? [];
  return channels.map((c) => (c.type === "webhook" ? c.urlSecret : c.webhookUrlSecret));
}
