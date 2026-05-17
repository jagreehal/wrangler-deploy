import { beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolveAccountId, resetResolvedAccountId } from "./auth.js";

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetResolvedAccountId();
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.HOME;
  mockExecFileSync.mockReset();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
});

describe("auth", () => {
  it("falls back to wrangler config when wrangler whoami fails and no API token", ({ task }) => {
    story.init(task);

    story.given("wrangler whoami throws and a local wrangler config exists (OAuth only)");
    process.env.HOME = "/home/tester";
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not logged in");
    });
    mockExistsSync.mockImplementation((path) =>
      typeof path === "string" && path === "/home/tester/.wrangler/config/default.toml",
    );
    mockReadFileSync.mockReturnValue('account_id = "1234567890abcdef1234567890abcdef"');

    story.when("resolveAccountId is called");
    const result = resolveAccountId("/cwd");

    story.then("the account id is read from the local config");
    expect(result).toBe("1234567890abcdef1234567890abcdef");
  });

  it("prefers CLOUDFLARE_ACCOUNT_ID over project context account id", ({ task }) => {
    story.init(task);

    story.given("both CLOUDFLARE_ACCOUNT_ID and project context accountId are set");
    process.env.CLOUDFLARE_ACCOUNT_ID = "11111111111111111111111111111111";
    mockExistsSync.mockImplementation((path) => typeof path === "string" && path === "/cwd/.wdrc");
    mockReadFileSync.mockReturnValue('{"accountId":"ABCDEFABCDEFABCDEFABCDEFABCDEFAB"}');

    story.when("resolveAccountId is called");
    const result = resolveAccountId("/cwd");

    story.then("the account id comes from CLOUDFLARE_ACCOUNT_ID");
    expect(result).toBe("11111111111111111111111111111111");
  });

  it("uses project context account id when CLOUDFLARE_ACCOUNT_ID is unset", ({ task }) => {
    story.init(task);

    story.given("a project context file provides an explicit account id and env is unset");
    mockExistsSync.mockImplementation((path) => typeof path === "string" && path === "/cwd/.wdrc");
    mockReadFileSync.mockReturnValue('{"accountId":"ABCDEFABCDEFABCDEFABCDEFABCDEFAB"}');

    story.when("resolveAccountId is called");
    const result = resolveAccountId("/cwd");

    story.then("the account id comes from the project context, normalized to lowercase hex");
    expect(result).toBe("abcdefabcdefabcdefabcdefabcdefab");
  });

  it("does not fall back to default.toml when CLOUDFLARE_API_TOKEN is set and whoami fails", ({ task }) => {
    story.init(task);

    story.given("API token auth but whoami fails so OAuth toml must not be used");
    process.env.CLOUDFLARE_API_TOKEN = "cf_pat_test";
    process.env.HOME = "/home/tester";
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not logged in");
    });
    mockExistsSync.mockReturnValue(false);

    story.when("resolveAccountId is called");
    expect(() => resolveAccountId("/cwd")).toThrow(/10000/);

    story.then("the error names explicit fixes and default.toml was not consulted");
    expect(() => resolveAccountId("/cwd")).toThrow(/\.wdrc|CLOUDFLARE_ACCOUNT_ID/);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("treats whitespace-only CLOUDFLARE_ACCOUNT_ID as unset and uses whoami", ({ task }) => {
    story.init(task);

    story.given("CLOUDFLARE_ACCOUNT_ID is only whitespace and whoami returns an account table row");
    process.env.CLOUDFLARE_ACCOUNT_ID = "  \t  ";
    mockExecFileSync.mockReturnValue(
      "│ Account │ fedcba9876543210fedcba9876543210 │\n",
    );

    story.when("resolveAccountId is called");
    const result = resolveAccountId("/cwd");

    story.then("the account id comes from whoami output");
    expect(result).toBe("fedcba9876543210fedcba9876543210");
  });

  it("rejects invalid CLOUDFLARE_ACCOUNT_ID shape", ({ task }) => {
    story.init(task);

    story.given("CLOUDFLARE_ACCOUNT_ID is not 32 hex characters");
    process.env.CLOUDFLARE_ACCOUNT_ID = "not-a-valid-account-id";

    story.when("resolveAccountId is called");
    expect(() => resolveAccountId("/cwd")).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(() => resolveAccountId("/cwd")).toThrow(/32-character hexadecimal/);
  });

  it("rejects invalid accountId in project context", ({ task }) => {
    story.init(task);

    story.given("project context accountId is present but not 32 hex characters");
    mockExistsSync.mockImplementation((path) => typeof path === "string" && path === "/cwd/.wdrc");
    mockReadFileSync.mockReturnValue('{"accountId":"too-short"}');

    story.when("resolveAccountId is called");
    expect(() => resolveAccountId("/cwd")).toThrow(/\.wdrc/);
    expect(() => resolveAccountId("/cwd")).toThrow(/32-character hexadecimal/);
  });

  it("prefers explicit --account-id override over env and project context", ({ task }) => {
    story.init(task);

    story.given("all account sources exist but an explicit override is supplied");
    process.env.CLOUDFLARE_ACCOUNT_ID = "11111111111111111111111111111111";
    mockExistsSync.mockImplementation((path) => typeof path === "string" && path === "/cwd/.wdrc");
    mockReadFileSync.mockReturnValue('{"accountId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');

    story.when("resolveAccountId is called with accountIdOverride");
    const result = resolveAccountId("/cwd", {
      accountIdOverride: "22222222222222222222222222222222",
    });

    story.then("the override wins");
    expect(result).toBe("22222222222222222222222222222222");
  });

  it("re-evaluates when CLOUDFLARE_ACCOUNT_ID changes in the same process", ({ task }) => {
    story.init(task);

    story.given("a first account id is resolved from env");
    process.env.CLOUDFLARE_ACCOUNT_ID = "11111111111111111111111111111111";
    const first = resolveAccountId("/cwd");
    expect(first).toBe("11111111111111111111111111111111");

    story.when("the env account id is changed and resolved again");
    process.env.CLOUDFLARE_ACCOUNT_ID = "22222222222222222222222222222222";
    const second = resolveAccountId("/cwd");

    story.then("the new value is used instead of a stale cwd-only cache");
    expect(second).toBe("22222222222222222222222222222222");
  });
});
