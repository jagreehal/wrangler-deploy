import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
// writeFileSync is used in the malformed-credentials test below.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyProfileToEnv,
  defaultProfileName,
  deleteCloudflareCredential,
  getProfile,
  listProfiles,
  loadProfilesFile,
  profileCredentialsPath,
  profilesConfigPath,
  profilesRoot,
  readCloudflareCredential,
  removeProfile,
  resolveProfileSelection,
  saveProfilesFile,
  upsertCloudflareProfile,
  writeCloudflareCredential,
} from "./profiles.js";

const ORIGINAL_ENV = { ...process.env };
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wd-profiles-"));
  delete process.env.WD_PROFILE;
  delete process.env.CLOUDFLARE_PROFILE;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  process.env.WD_HOME = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
});

describe("profiles paths", () => {
  it("honors WD_HOME override", () => {
    expect(profilesRoot()).toBe(tmpDir);
    expect(profilesConfigPath()).toBe(join(tmpDir, "config.json"));
    expect(profileCredentialsPath("prod", "cloudflare")).toBe(
      join(tmpDir, "credentials", "prod", "cloudflare.json"),
    );
  });

  it("default profile name is 'default'", () => {
    expect(defaultProfileName()).toBe("default");
  });
});

describe("profiles file I/O", () => {
  it("returns empty file when config.json missing", () => {
    expect(loadProfilesFile()).toEqual({ version: 1, profiles: {} });
  });

  it("upserts and reads back a profile", () => {
    upsertCloudflareProfile("prod", {
      method: "api-token",
      metadata: { id: "acc_1", name: "Prod" },
    });
    const profile = getProfile("prod");
    expect(profile?.cloudflare?.method).toBe("api-token");
    expect(profile?.cloudflare?.metadata).toEqual({ id: "acc_1", name: "Prod" });
  });

  it("listProfiles returns sorted names", () => {
    upsertCloudflareProfile("prod", { method: "api-token", metadata: { id: "1" } });
    upsertCloudflareProfile("dev", { method: "api-token", metadata: { id: "2" } });
    expect(listProfiles()).toEqual(["dev", "prod"]);
  });

  it("removeProfile drops the entry and reports success", () => {
    upsertCloudflareProfile("dev", { method: "api-token", metadata: { id: "1" } });
    expect(removeProfile("dev")).toBe(true);
    expect(removeProfile("dev")).toBe(false);
    expect(listProfiles()).toEqual([]);
  });

  it("normalizes invalid entries on load", () => {
    saveProfilesFile({ version: 1, profiles: { bogus: { cloudflare: { method: "wat" } as never } } });
    expect(getProfile("bogus")?.cloudflare).toBeUndefined();
  });
});

describe("credentials I/O", () => {
  it("writes, reads, and deletes api-token credentials", () => {
    const path = writeCloudflareCredential("dev", { type: "api-token", token: "cf_pat_123" });
    expect(existsSync(path)).toBe(true);

    const credential = readCloudflareCredential("dev");
    expect(credential).toEqual({ type: "api-token", token: "cf_pat_123" });

    expect(deleteCloudflareCredential("dev")).toBe(true);
    expect(deleteCloudflareCredential("dev")).toBe(false);
    expect(readCloudflareCredential("dev")).toBeUndefined();
  });

  it("writes credential file with 0600 perms on POSIX", () => {
    if (process.platform === "win32") return;
    const path = writeCloudflareCredential("dev", { type: "api-token", token: "x" });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("reads oauth credentials with all fields", () => {
    writeCloudflareCredential("dev", { type: "oauth", access: "a", refresh: "r", expires: 123 });
    const credential = readCloudflareCredential("dev");
    expect(credential).toEqual({ type: "oauth", access: "a", refresh: "r", expires: 123 });
  });

  it("rejects malformed credentials", () => {
    const path = profileCredentialsPath("dev", "cloudflare");
    writeCloudflareCredential("dev", { type: "api-token", token: "ok" });
    writeFileSync(path, JSON.stringify({ type: "api-token" }));
    expect(readCloudflareCredential("dev")).toBeUndefined();
  });
});

describe("resolveProfileSelection", () => {
  it("uses --profile flag first", () => {
    process.env.WD_PROFILE = "envdev";
    expect(resolveProfileSelection(["plan", "--profile", "prod"])).toEqual({
      name: "prod",
      source: "flag",
    });
  });

  it("falls back to WD_PROFILE", () => {
    process.env.WD_PROFILE = "envdev";
    expect(resolveProfileSelection(["plan"])).toEqual({ name: "envdev", source: "wd-env" });
  });

  it("falls back to CLOUDFLARE_PROFILE next", () => {
    process.env.CLOUDFLARE_PROFILE = "cfprod";
    expect(resolveProfileSelection(["plan"])).toEqual({ name: "cfprod", source: "cloudflare-env" });
  });

  it("defaults to 'default'", () => {
    expect(resolveProfileSelection(["plan"])).toEqual({ name: "default", source: "default" });
  });

  it("ignores --profile when value is missing or another flag", () => {
    expect(resolveProfileSelection(["plan", "--profile"])).toEqual({
      name: "default",
      source: "default",
    });
    expect(resolveProfileSelection(["plan", "--profile", "--stage"])).toEqual({
      name: "default",
      source: "default",
    });
  });
});

describe("applyProfileToEnv", () => {
  it("sets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from profile", () => {
    upsertCloudflareProfile("prod", {
      method: "api-token",
      metadata: { id: "acc_42", name: "Prod" },
    });
    writeCloudflareCredential("prod", { type: "api-token", token: "cf_pat_abc" });

    const result = applyProfileToEnv("prod");
    expect(result.appliedToken).toBe(true);
    expect(result.appliedAccountId).toBe(true);
    expect(result.method).toBe("api-token");
    expect(process.env.CLOUDFLARE_API_TOKEN).toBe("cf_pat_abc");
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBe("acc_42");
  });

  it("never overrides an existing CLOUDFLARE_API_TOKEN in env", () => {
    upsertCloudflareProfile("prod", { method: "api-token", metadata: { id: "acc_42" } });
    writeCloudflareCredential("prod", { type: "api-token", token: "from-profile" });
    process.env.CLOUDFLARE_API_TOKEN = "from-shell";

    const result = applyProfileToEnv("prod");
    expect(result.appliedToken).toBe(false);
    expect(process.env.CLOUDFLARE_API_TOKEN).toBe("from-shell");
  });

  it("never overrides an existing CLOUDFLARE_ACCOUNT_ID in env", () => {
    upsertCloudflareProfile("prod", { method: "api-token", metadata: { id: "from-profile" } });
    process.env.CLOUDFLARE_ACCOUNT_ID = "from-shell";

    const result = applyProfileToEnv("prod");
    expect(result.appliedAccountId).toBe(false);
    expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBe("from-shell");
  });

  it("returns no-op result when profile does not exist", () => {
    const result = applyProfileToEnv("nope");
    expect(result.appliedToken).toBe(false);
    expect(result.appliedAccountId).toBe(false);
    expect(result.method).toBeUndefined();
  });

  it("does not set token when credential file is missing", () => {
    upsertCloudflareProfile("prod", { method: "api-token", metadata: { id: "acc_42" } });
    const result = applyProfileToEnv("prod");
    expect(result.appliedToken).toBe(false);
    expect(result.appliedAccountId).toBe(true);
  });
});

describe("config file persistence", () => {
  it("emits version 1 with the profiles map", () => {
    upsertCloudflareProfile("dev", { method: "api-token", metadata: { id: "x" } });
    const raw = readFileSync(profilesConfigPath(), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.profiles.dev.cloudflare.method).toBe("api-token");
  });
});
