import { describe, expect, it } from "vitest";
import { cliManifest } from "../core/cli-manifest.js";
import {
  CATEGORY_ORDER,
  findAction,
  getRegistry,
  getRegistryByCategory,
} from "./registry.js";

describe("cli registry", () => {
  it("contains an entry for every manifest command", () => {
    const registryNames = new Set(getRegistry().map((a) => a.name));
    for (const cmd of cliManifest.commands) {
      expect(registryNames.has(cmd.name), `missing registry entry: ${cmd.name}`).toBe(true);
    }
  });

  it("synthesizes the `actions` command itself so it is self-describing", () => {
    const entry = findAction("actions");
    expect(entry).toBeDefined();
    expect(entry?.category).toBe("meta");
  });

  it("every action declares a known category", () => {
    for (const action of getRegistry()) {
      expect(CATEGORY_ORDER).toContain(action.category);
    }
  });

  it("lifecycle commands list at least one follow-up", () => {
    for (const name of ["apply", "deploy", "up", "destroy", "plan"]) {
      const action = findAction(name);
      expect(action, `missing ${name}`).toBeDefined();
      expect(action!.next.length, `${name} has no follow-ups`).toBeGreaterThan(0);
    }
  });

  it("groups actions by category", () => {
    const grouped = getRegistryByCategory();
    expect(grouped.lifecycle.some((a) => a.name === "apply")).toBe(true);
    expect(grouped.observability.some((a) => a.name === "status")).toBe(true);
    expect(grouped.auth.some((a) => a.name === "login")).toBe(true);
    expect(grouped.meta.some((a) => a.name === "actions")).toBe(true);
  });

  it("apply registry entry matches the `apply` text-mode follow-ups", () => {
    // Source of truth: the `printNextActions(["wd deploy --stage ...", ...])`
    // call in cli/index.ts uses commands "deploy" and "status" — the registry
    // must agree so JSON and text never drift.
    const apply = findAction("apply");
    expect(apply?.next).toEqual(expect.arrayContaining(["deploy", "status"]));
  });

  it("up registry entry agrees with cli text-mode follow-ups", () => {
    const up = findAction("up");
    expect(up?.next).toEqual(expect.arrayContaining(["status", "tail"]));
  });

  it("deploy registry entry agrees with cli text-mode follow-ups", () => {
    const deploy = findAction("deploy");
    // text path printNextActions for deploy suggests status + tail/verify
    expect(deploy?.next).toEqual(expect.arrayContaining(["status"]));
  });
});
