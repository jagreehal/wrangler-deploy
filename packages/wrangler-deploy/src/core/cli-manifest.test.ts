import { describe, expect, it } from "vitest";
import { cliManifest } from "./cli-manifest.js";

describe("cliManifest", () => {
  it("declares agent-friendly machine readable defaults", () => {
    expect(cliManifest.machineReadableDefaults.json).toBe(true);
    expect(cliManifest.machineReadableDefaults.dryRun).toBe(true);
    expect(cliManifest.machineReadableDefaults.fields).toBe(true);
    expect(cliManifest.machineReadableDefaults.ndjson).toBe(true);
  });

  it("exposes schema and json flags for the main commands", () => {
    const commandNames = cliManifest.commands.map((command) => command.name);
    expect(commandNames).toContain("create");
    expect(commandNames).toContain("schema");
    expect(commandNames).toContain("context");
    expect(commandNames).toContain("tools");
    expect(commandNames).toContain("plan");
    expect(cliManifest.commands.find((command) => command.name === "plan")?.flags).toContain("--json");
    expect(cliManifest.commands.find((command) => command.name === "create")?.subcommands).toEqual([
      "vite",
    ]);
    expect(cliManifest.commands.find((command) => command.name === "destroy")?.flags).toContain("--dry-run");
    expect(cliManifest.commands.find((command) => command.name === "context")?.subcommands).toEqual([
      "get",
      "set",
      "unset",
      "clear",
    ]);
  });
});
