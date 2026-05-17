import { describe, expect, it } from "vitest";
import { cliManifest } from "./cli-manifest.js";

describe("cliManifest", () => {
  it("declares agent-friendly machine readable defaults", () => {
    expect(cliManifest.machineReadableDefaults.json).toBe(true);
    expect(cliManifest.machineReadableDefaults.dryRun).toBe(true);
    expect(cliManifest.machineReadableDefaults.fields).toBe(true);
    expect(cliManifest.machineReadableDefaults.ndjson).toBe(true);
  });

  it("publishes resource capability metadata", () => {
    expect(cliManifest.resourceCapabilities.adopt.supportedResourceTypes).toEqual([
      "kv",
      "queue",
      "hyperdrive",
    ]);
    expect(cliManifest.resourceCapabilities.adopt.unsupportedBehavior).toBe("error");
  });

  it("exposes schema and json flags for the main commands", () => {
    const commandNames = cliManifest.commands.map((command) => command.name);
    expect(commandNames).toContain("create");
    expect(commandNames).toContain("schema");
    expect(commandNames).toContain("context");
    expect(commandNames).toContain("tools");
    expect(commandNames).toContain("open");
    expect(commandNames).toContain("dashboard");
    expect(commandNames).toContain("explain");
    expect(commandNames).toContain("telemetry");
    expect(commandNames).toContain("auth");
    expect(commandNames).toContain("rollback");
    expect(commandNames).toContain("history");
    expect(commandNames).toContain("check");
    expect(commandNames).toContain("quickstart");
    expect(commandNames).toContain("macro");
    expect(commandNames).toContain("release-note");
    expect(commandNames).toContain("plan");
    expect(cliManifest.commands.find((command) => command.name === "plan")?.flags).toContain("--json");
    expect(cliManifest.commands.find((command) => command.name === "create")?.subcommands).toEqual([
      "vite",
    ]);
    expect(cliManifest.commands.find((command) => command.name === "destroy")?.flags).toContain("--dry-run");
    expect(cliManifest.commands.find((command) => command.name === "deploy")?.flags).toContain("--changed");
    expect(cliManifest.commands.find((command) => command.name === "rollback")?.subcommands).toEqual(["list"]);
    expect(cliManifest.commands.find((command) => command.name === "deploy")?.flags).toContain("--plan-only");
    expect(cliManifest.commands.find((command) => command.name === "open")?.flags).toContain("--copy");
    expect(cliManifest.commands.find((command) => command.name === "status")?.flags).toContain("--output");
    expect(cliManifest.commands.find((command) => command.name === "context")?.subcommands).toEqual([
      "get",
      "set",
      "unset",
      "clear",
      "doctor",
      "export",
      "import",
    ]);
  });
});
