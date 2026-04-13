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
  delete process.env.HOME;
  mockExecFileSync.mockReset();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
});

describe("auth", () => {
  it("falls back to wrangler config when wrangler whoami fails", ({ task }) => {
    story.init(task);

    story.given("wrangler whoami throws and a local wrangler config exists");
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

  it("prefers the project context account id when present", ({ task }) => {
    story.init(task);

    story.given("a project context file provides an explicit account id");
    mockExistsSync.mockImplementation((path) => typeof path === "string" && path === "/cwd/.wdrc");
    mockReadFileSync.mockReturnValue('{"accountId":"abcdefabcdefabcdefabcdefabcdefab"}');

    story.when("resolveAccountId is called");
    const result = resolveAccountId("/cwd");

    story.then("the account id comes from the project context");
    expect(result).toBe("abcdefabcdefabcdefabcdefabcdefab");
  });
});
