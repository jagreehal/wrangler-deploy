import { describe, expect, it } from "vitest";
import { detectNonInteractive, runPicker } from "./scaffold-picker.js";

const SAMPLE_MANIFEST = {
  version: 1 as const,
  templates: [
    { name: "vite", title: "Vite", description: "frontend starter" },
    { name: "hono", title: "Hono", description: "backend starter" },
  ],
};

describe("runPicker (non-interactive)", () => {
  it("returns inline defaults when no inputs are provided", async () => {
    const result = await runPicker({
      manifest: SAMPLE_MANIFEST,
      nonInteractive: true,
    });
    expect(result.dir).toBe("my-worker");
    expect(result.template).toBe("hello");
  });

  it("respects the dir input", async () => {
    const result = await runPicker({
      initialDir: "my-app",
      manifest: SAMPLE_MANIFEST,
      nonInteractive: true,
    });
    expect(result.dir).toBe("my-app");
  });

  it("respects the template input", async () => {
    const result = await runPicker({
      initialTemplate: "vite",
      manifest: SAMPLE_MANIFEST,
      nonInteractive: true,
    });
    expect(result.template).toBe("vite");
  });
});

describe("detectNonInteractive", () => {
  it("is true under CI=true", () => {
    const original = process.env.CI;
    process.env.CI = "true";
    try {
      expect(detectNonInteractive()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.CI;
      else process.env.CI = original;
    }
  });

  it("is true when WD_NO_INTERACTIVE=1", () => {
    const original = process.env.WD_NO_INTERACTIVE;
    process.env.WD_NO_INTERACTIVE = "1";
    try {
      expect(detectNonInteractive()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.WD_NO_INTERACTIVE;
      else process.env.WD_NO_INTERACTIVE = original;
    }
  });

  it("is true when WD_FORCE_INTERACTIVE is unset and stdin isn't a TTY", () => {
    // Test environments usually don't have a TTY, so this should be true.
    delete process.env.WD_FORCE_INTERACTIVE;
    delete process.env.WD_NO_INTERACTIVE;
    delete process.env.CI;
    delete process.env.AGENT_SANDBOX;
    expect(detectNonInteractive()).toBe(true);
  });
});
