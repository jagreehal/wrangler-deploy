import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cliManifest } from "./core/cli-manifest.js";
import { buildAgentContext } from "../scripts/generate-agent-context.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const agentContextPath = resolve(rootDir, "agent-context.json");

describe("agent-context", () => {
  it("is valid JSON and matches the generated context", () => {
    const parsed = JSON.parse(readFileSync(agentContextPath, "utf8")) as {
      package?: string;
      commands?: Array<{ name: string }>;
    };

    expect(parsed).toEqual(buildAgentContext());
    expect(parsed.package).toBe(cliManifest.package);
    expect(parsed.commands?.map((command) => command.name)).toEqual(
      cliManifest.commands.map((command) => command.name),
    );
  });
});
