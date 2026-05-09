import { describe, expect, it } from "vitest";
import { parseArgs, requireString, boolFlag } from "./parse.js";

describe("parseArgs", () => {
  it("returns help when no args", () => {
    expect(parseArgs(["node", "wug"])).toEqual({ command: "help", positional: [], flags: {} });
  });

  it("treats --help as help command", () => {
    expect(parseArgs(["node", "wug", "--help"]).command).toBe("help");
  });

  it("treats --version as version command", () => {
    expect(parseArgs(["node", "wug", "-v"]).command).toBe("version");
  });

  it("parses command + positional args", () => {
    const r = parseArgs(["node", "wug", "approve", "appr-123"]);
    expect(r.command).toBe("approve");
    expect(r.positional).toEqual(["appr-123"]);
  });

  it("parses --key=value flag", () => {
    const r = parseArgs(["node", "wug", "deploy", "--account=abc"]);
    expect(r.flags.account).toBe("abc");
  });

  it("parses --key value flag", () => {
    const r = parseArgs(["node", "wug", "deploy", "--account", "abc"]);
    expect(r.flags.account).toBe("abc");
  });

  it("treats listed boolean flags as boolean even with following token", () => {
    const r = parseArgs(["node", "wug", "migrate", "--local", "--database", "x"]);
    expect(r.flags.local).toBe(true);
    expect(r.flags.database).toBe("x");
  });

  it("treats trailing flag as boolean when no following value", () => {
    const r = parseArgs(["node", "wug", "deploy", "--yes"]);
    expect(r.flags.yes).toBe(true);
  });

  it("requireString throws on missing", () => {
    expect(() => requireString({}, "account")).toThrow(/account/);
  });

  it("requireString returns value", () => {
    expect(requireString({ account: "abc" }, "account")).toBe("abc");
  });

  it("boolFlag", () => {
    expect(boolFlag({ json: true }, "json")).toBe(true);
    expect(boolFlag({}, "json")).toBe(false);
    expect(boolFlag({ json: "no" }, "json")).toBe(false);
  });
});
