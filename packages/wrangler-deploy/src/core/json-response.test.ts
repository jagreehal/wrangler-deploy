import { describe, expect, it } from "vitest";
import { makeErr, makeOk, nextFromCommands } from "./json-response.js";

describe("WdJsonResponse envelope", () => {
  const baseOpts = {
    command: "apply",
    startedAt: performance.now(),
    wdVersion: "1.5.3",
    stage: "dev",
  };

  it("makeOk produces a complete envelope with meta", () => {
    const env = makeOk({ created: ["api"] }, baseOpts);
    expect(env.command).toBe("apply");
    expect(env.ok).toBe(true);
    expect(env.result).toEqual({ created: ["api"] });
    expect(env.meta.stage).toBe("dev");
    expect(env.meta.wdVersion).toBe("1.5.3");
    expect(env.meta.schemaVersion).toBe("1");
    expect(typeof env.meta.durationMs).toBe("number");
    expect(env.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("makeOk omits next/warnings when empty for a tidy payload", () => {
    const env = makeOk({}, baseOpts);
    expect("next" in env).toBe(false);
    expect("warnings" in env).toBe(false);
  });

  it("makeOk preserves next entries when supplied", () => {
    const env = makeOk({}, {
      ...baseOpts,
      next: [{ cmd: "wd deploy --stage dev", why: "ship the apply" }],
    });
    expect(env.next).toEqual([{ cmd: "wd deploy --stage dev", why: "ship the apply" }]);
  });

  it("makeErr fills in doc pointers automatically", () => {
    const env = makeErr(
      [{ code: "WD_E_STATE_MISSING", message: "no state for dev", fix: "Run wd apply." }],
      baseOpts,
    );
    expect(env.ok).toBe(false);
    expect(env.errors?.[0]?.doc).toBe("wd explain WD_E_STATE_MISSING");
  });

  it("makeErr keeps an explicit doc override", () => {
    const env = makeErr(
      [{ code: "WD_E_X", message: "x", doc: "https://example.com" }],
      baseOpts,
    );
    expect(env.errors?.[0]?.doc).toBe("https://example.com");
  });

  it("nextFromCommands converts string suggestions", () => {
    const next = nextFromCommands(["wd deploy --stage dev", { cmd: "wd status", why: "verify" }]);
    expect(next).toEqual([
      { cmd: "wd deploy --stage dev", why: "" },
      { cmd: "wd status", why: "verify" },
    ]);
  });
});
