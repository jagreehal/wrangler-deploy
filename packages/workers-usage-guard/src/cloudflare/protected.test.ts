// src/cloudflare/protected.test.ts
import { describe, it, expect } from "vitest";
import { isProtected } from "./protected.js";
import { stubs } from "../test-utils/stubs.js";

describe("isProtected", () => {
  it("guard script is always protected", () => {
    const a = stubs.accountConfig({ workers: [stubs.workerConfig({ scriptName: "api" })] });
    expect(isProtected({ scriptName: "workers-usage-guard", guardScriptName: "workers-usage-guard", account: a })).toBe(true);
  });

  it("globalProtected match", () => {
    const a = stubs.accountConfig({ globalProtected: ["critical-svc"] });
    expect(isProtected({ scriptName: "critical-svc", guardScriptName: "g", account: a })).toBe(true);
  });

  it("per-worker protected flag", () => {
    const a = stubs.accountConfig({ workers: [stubs.workerConfig({ scriptName: "api", protected: true })] });
    expect(isProtected({ scriptName: "api", guardScriptName: "g", account: a })).toBe(true);
  });

  it("unknown script -> not protected", () => {
    const a = stubs.accountConfig();
    expect(isProtected({ scriptName: "nope", guardScriptName: "g", account: a })).toBe(false);
  });

  it("runtime-protected set match → protected", () => {
    const a = stubs.accountConfig({ accountId: "a", workers: [stubs.workerConfig({ scriptName: "api" })] });
    expect(
      isProtected({
        scriptName: "api",
        guardScriptName: "g",
        account: a,
        runtimeProtected: new Set(["a:api"]),
      })
    ).toBe(true);
  });

  it("runtime-protected set miss → falls back to other rules", () => {
    const a = stubs.accountConfig({ workers: [stubs.workerConfig({ scriptName: "api" })] });
    expect(
      isProtected({
        scriptName: "api",
        guardScriptName: "g",
        account: a,
        runtimeProtected: new Set(["other:other"]),
      })
    ).toBe(false);
  });
});
