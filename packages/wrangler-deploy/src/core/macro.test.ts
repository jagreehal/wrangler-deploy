import { describe, expect, it } from "vitest";
import { macroCommandName, splitMacroBody, tokenizeCommandText } from "./macro.js";

describe("macro helpers", () => {
  it("splits macro body into commands", () => {
    expect(splitMacroBody("wd check --stage dev && wd verify --stage dev")).toEqual([
      "wd check --stage dev",
      "wd verify --stage dev",
    ]);
  });

  it("tokenizes quoted command arguments", () => {
    expect(tokenizeCommandText("wd queue send q --json '{\"k\":\"v x\"}'")).toEqual([
      "wd",
      "queue",
      "send",
      "q",
      "--json",
      "{\"k\":\"v x\"}",
    ]);
  });

  it("throws on unterminated quote", () => {
    expect(() => tokenizeCommandText("wd explain \"broken")).toThrow("Unterminated quoted string");
  });

  it("extracts command names for validation", () => {
    expect(macroCommandName("wd deploy --stage dev")).toBe("deploy");
    expect(macroCommandName("deploy --stage dev")).toBe("deploy");
  });
});
