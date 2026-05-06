import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/**
 * Profile system for managing multiple Cloudflare account credentials.
 *
 *
 *   ~/.wrangler-deploy/
 *     config.json                              <- non-sensitive metadata
 *     credentials/<profile>/cloudflare.json    <- secrets, chmod 600
 *
 * Profiles are orthogonal to wrangler.jsonc — they only affect which
 * Cloudflare account/token the CLI uses at runtime.
 */

export type AuthMethod = "api-token" | "oauth";

export interface CloudflareProfileMetadata {
  id: string;
  name?: string;
}

export interface CloudflareProfileConfig {
  method: AuthMethod;
  metadata?: CloudflareProfileMetadata;
}

export interface ProfileConfig {
  cloudflare?: CloudflareProfileConfig;
}

export interface ProfilesFile {
  version: 1;
  profiles: Record<string, ProfileConfig>;
}

export interface CloudflareApiTokenCredential {
  type: "api-token";
  token: string;
}

export interface CloudflareOAuthCredential {
  type: "oauth";
  access: string;
  refresh?: string;
  expires?: number;
}

export type CloudflareCredential = CloudflareApiTokenCredential | CloudflareOAuthCredential;

const DEFAULT_PROFILE_NAME = "default";

export function defaultProfileName(): string {
  return DEFAULT_PROFILE_NAME;
}

export function profilesRoot(home: string = homedir()): string {
  const override = process.env.WD_HOME;
  if (override && override.trim()) return resolve(override.trim());
  return resolve(home, ".wrangler-deploy");
}

export function profilesConfigPath(home?: string): string {
  return resolve(profilesRoot(home), "config.json");
}

export function profileCredentialsPath(
  profile: string,
  provider: "cloudflare",
  home?: string,
): string {
  return resolve(profilesRoot(home), "credentials", profile, `${provider}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProfilesFile(value: unknown): ProfilesFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.profiles)) {
    return { version: 1, profiles: {} };
  }

  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, raw] of Object.entries(value.profiles)) {
    if (!isRecord(raw)) continue;
    const profile: ProfileConfig = {};

    if (isRecord(raw.cloudflare)) {
      const method = raw.cloudflare.method;
      if (method === "api-token" || method === "oauth") {
        const cf: CloudflareProfileConfig = { method };
        if (isRecord(raw.cloudflare.metadata)) {
          const id = raw.cloudflare.metadata.id;
          const name2 = raw.cloudflare.metadata.name;
          if (typeof id === "string" && id) {
            cf.metadata = { id };
            if (typeof name2 === "string") cf.metadata.name = name2;
          }
        }
        profile.cloudflare = cf;
      }
    }

    profiles[name] = profile;
  }

  return { version: 1, profiles };
}

export function loadProfilesFile(home?: string): ProfilesFile {
  const path = profilesConfigPath(home);
  if (!existsSync(path)) return { version: 1, profiles: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return normalizeProfilesFile(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${(error as Error).message}`, { cause: error });
  }
}

export function saveProfilesFile(file: ProfilesFile, home?: string): string {
  const path = profilesConfigPath(home);
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  return path;
}

export function listProfiles(home?: string): string[] {
  const file = loadProfilesFile(home);
  return Object.keys(file.profiles).sort();
}

export function getProfile(name: string, home?: string): ProfileConfig | undefined {
  return loadProfilesFile(home).profiles[name];
}

export function upsertCloudflareProfile(
  name: string,
  cloudflare: CloudflareProfileConfig,
  home?: string,
): ProfilesFile {
  const file = loadProfilesFile(home);
  const existing = file.profiles[name] ?? {};
  file.profiles[name] = { ...existing, cloudflare };
  saveProfilesFile(file, home);
  return file;
}

export function removeProfile(name: string, home?: string): boolean {
  const file = loadProfilesFile(home);
  if (!(name in file.profiles)) return false;
  delete file.profiles[name];
  saveProfilesFile(file, home);
  return true;
}

export function readCloudflareCredential(
  profile: string,
  home?: string,
): CloudflareCredential | undefined {
  const path = profileCredentialsPath(profile, "cloudflare", home);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isRecord(raw)) return undefined;
    if (raw.type === "api-token" && typeof raw.token === "string" && raw.token) {
      return { type: "api-token", token: raw.token };
    }
    if (raw.type === "oauth" && typeof raw.access === "string" && raw.access) {
      const credential: CloudflareOAuthCredential = {
        type: "oauth",
        access: raw.access,
      };
      if (typeof raw.refresh === "string") credential.refresh = raw.refresh;
      if (typeof raw.expires === "number") credential.expires = raw.expires;
      return credential;
    }
    return undefined;
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${(error as Error).message}`, { cause: error });
  }
}

export function writeCloudflareCredential(
  profile: string,
  credential: CloudflareCredential,
  home?: string,
): string {
  const path = profileCredentialsPath(profile, "cloudflare", home);
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(credential, null, 2)}\n`, "utf-8");
  // Best-effort tighten perms; ignored on platforms without POSIX perms.
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }
  return path;
}

export function deleteCloudflareCredential(profile: string, home?: string): boolean {
  const path = profileCredentialsPath(profile, "cloudflare", home);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    return;
  }
  // Tighten perms if directory already exists.
  try {
    chmodSync(path, 0o700);
  } catch {
    // ignore
  }
}

/**
 * Resolve which profile to use for a CLI invocation.
 *
 * Order of precedence (first hit wins):
 *   1. --profile flag
 *   2. WD_PROFILE env var
 *   3. CLOUDFLARE_PROFILE env var
 *   4. "default"
 *
 * Returns the resolved name plus the source for logging/diagnostics.
 */
export function resolveProfileSelection(args: string[]): {
  name: string;
  source: "flag" | "wd-env" | "cloudflare-env" | "default";
} {
  const flagIndex = args.indexOf("--profile");
  if (flagIndex !== -1) {
    const value = args[flagIndex + 1];
    if (value && !value.startsWith("--")) {
      return { name: value, source: "flag" };
    }
  }
  if (process.env.WD_PROFILE && process.env.WD_PROFILE.trim()) {
    return { name: process.env.WD_PROFILE.trim(), source: "wd-env" };
  }
  if (process.env.CLOUDFLARE_PROFILE && process.env.CLOUDFLARE_PROFILE.trim()) {
    return { name: process.env.CLOUDFLARE_PROFILE.trim(), source: "cloudflare-env" };
  }
  return { name: DEFAULT_PROFILE_NAME, source: "default" };
}

/**
 * Apply a profile to process.env so existing auth.ts and wrangler-runner code
 * picks up the credentials and account ID without further changes.
 *
 * Existing env vars take precedence — never overwrite an explicit
 * CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID set by the user/CI.
 *
 * Returns a description of what was applied (for diagnostics).
 */
export interface AppliedProfile {
  profile: string;
  appliedToken: boolean;
  appliedAccountId: boolean;
  accountId?: string;
  accountName?: string;
  method?: AuthMethod;
}

export function applyProfileToEnv(profileName: string, home?: string): AppliedProfile {
  const result: AppliedProfile = {
    profile: profileName,
    appliedToken: false,
    appliedAccountId: false,
  };

  const profile = getProfile(profileName, home);
  if (!profile?.cloudflare) return result;

  result.method = profile.cloudflare.method;
  if (profile.cloudflare.metadata?.id) {
    result.accountId = profile.cloudflare.metadata.id;
    if (profile.cloudflare.metadata.name) {
      result.accountName = profile.cloudflare.metadata.name;
    }
    if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
      process.env.CLOUDFLARE_ACCOUNT_ID = profile.cloudflare.metadata.id;
      result.appliedAccountId = true;
    }
  }

  if (!process.env.CLOUDFLARE_API_TOKEN) {
    const credential = readCloudflareCredential(profileName, home);
    if (credential?.type === "api-token") {
      process.env.CLOUDFLARE_API_TOKEN = credential.token;
      result.appliedToken = true;
    } else if (credential?.type === "oauth") {
      // OAuth tokens flow through wrangler's own ~/.wrangler config; we
      // don't push them into env. The wrangler CLI will resolve them.
    }
  }

  return result;
}
