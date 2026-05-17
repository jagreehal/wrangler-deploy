import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AgentErrorException } from "./cli-output.js";
import {
  assertWranglerVersion,
  compareSemver,
  evaluateVersion,
  parseSemver,
  parseWranglerVersionOutput,
  resetWranglerVersionCache,
  MIN_WRANGLER_VERSION,
} from "./wrangler-version-check.js";

// The vitest config sets WD_SKIP_WRANGLER_VERSION_CHECK=1 globally so the rest
// of the suite's mocked-spawn tests don't gate on a real wrangler. This file
// is the one place that tests the check itself, so clear the bypass.
const originalSkip = process.env.WD_SKIP_WRANGLER_VERSION_CHECK;
delete process.env.WD_SKIP_WRANGLER_VERSION_CHECK;

afterEach(() => {
  resetWranglerVersionCache();
});

afterAll(() => {
  if (originalSkip !== undefined) {
    process.env.WD_SKIP_WRANGLER_VERSION_CHECK = originalSkip;
  }
});

describe("parseSemver", () => {
  it("extracts major.minor.patch", () => {
    expect(parseSemver("3.91.0")).toEqual({ major: 3, minor: 91, patch: 0 });
    expect(parseSemver("v4.88.0")).toEqual({ major: 4, minor: 88, patch: 0 });
    expect(parseSemver("garbage")).toBeUndefined();
  });
});

describe("compareSemver", () => {
  it("orders semvers correctly", () => {
    const a = parseSemver("3.91.0")!;
    const b = parseSemver("3.91.0")!;
    const older = parseSemver("3.50.0")!;
    const newer = parseSemver("4.88.0")!;
    expect(compareSemver(a, b)).toBe(0);
    expect(compareSemver(older, a)).toBe(-1);
    expect(compareSemver(newer, a)).toBe(1);
    expect(compareSemver(parseSemver("3.91.0")!, parseSemver("3.91.1")!)).toBe(-1);
    expect(compareSemver(parseSemver("3.92.0")!, parseSemver("3.91.99")!)).toBe(1);
  });
});

describe("parseWranglerVersionOutput", () => {
  it("handles bare and decorated formats", () => {
    expect(parseWranglerVersionOutput("wrangler 3.91.0")).toBe("3.91.0");
    expect(parseWranglerVersionOutput(" ⛅️ wrangler 4.88.0 (update available 4.92.0)")).toBe("4.88.0");
    expect(parseWranglerVersionOutput("4.90.0\n")).toBe("4.90.0");
    expect(parseWranglerVersionOutput("no version here")).toBeUndefined();
  });
});

describe("evaluateVersion", () => {
  it("accepts the documented floor exactly", () => {
    expect(evaluateVersion(`wrangler ${MIN_WRANGLER_VERSION}`).kind).toBe("ok");
  });

  it("accepts a sufficiently new 3.x", () => {
    expect(evaluateVersion("wrangler 3.114.1").kind).toBe("ok");
  });

  it("accepts wrangler 4.x within the supported major range", () => {
    expect(evaluateVersion("wrangler 4.88.0").kind).toBe("ok");
    expect(evaluateVersion("wrangler 4.92.0").kind).toBe("ok");
  });

  it("flags versions below the floor", () => {
    expect(evaluateVersion("wrangler 3.50.0").kind).toBe("too-old");
    expect(evaluateVersion("wrangler 3.90.99").kind).toBe("too-old");
    expect(evaluateVersion("0.0.0").kind).toBe("too-old");
  });

  it("flags versions at/above the unsupported next major", () => {
    expect(evaluateVersion("wrangler 5.0.0").kind).toBe("too-new");
    expect(evaluateVersion("999.0.0").kind).toBe("too-new");
  });

  it("flags missing/unparseable output", () => {
    expect(evaluateVersion(undefined).kind).toBe("not-installed");
    expect(evaluateVersion("garbled output").kind).toBe("unparseable");
  });
});

describe("assertWranglerVersion", () => {
  it("passes when the injected version is >= floor and < next major", () => {
    expect(() =>
      assertWranglerVersion({ readVersion: () => "wrangler 3.91.0" }),
    ).not.toThrow();
  });

  it("throws WD_E_DEPS_MISSING (too-old) with helpful copy", () => {
    let err: AgentErrorException | undefined;
    try {
      assertWranglerVersion({ readVersion: () => "wrangler 3.50.0" });
    } catch (e) {
      err = e as AgentErrorException;
    }
    expect(err).toBeInstanceOf(AgentErrorException);
    expect(err!.agentError.code).toBe("WD_E_DEPS_MISSING");
    expect(err!.agentError.message).toContain("3.50.0");
    expect(err!.agentError.message).toContain(MIN_WRANGLER_VERSION);
    expect(err!.agentError.fix).toContain("wrangler@latest");
  });

  it("throws on 0.0.0", () => {
    expect(() =>
      assertWranglerVersion({ readVersion: () => "0.0.0" }),
    ).toThrowError(AgentErrorException);
  });

  it("passes on a far-future patched 4.x like 999.0.0 only if major < 5 (so 999 throws too-new)", () => {
    let err: AgentErrorException | undefined;
    try {
      assertWranglerVersion({ readVersion: () => "999.0.0" });
    } catch (e) {
      err = e as AgentErrorException;
    }
    expect(err).toBeInstanceOf(AgentErrorException);
    expect(err!.agentError.message).toContain("999.0.0");
  });

  it("treats a read failure as not-installed", () => {
    let err: AgentErrorException | undefined;
    try {
      assertWranglerVersion({
        readVersion: () => {
          throw new Error("npx ENOENT");
        },
      });
    } catch (e) {
      err = e as AgentErrorException;
    }
    expect(err).toBeInstanceOf(AgentErrorException);
    expect(err!.agentError.code).toBe("WD_E_DEPS_MISSING");
    expect(err!.agentError.message).toContain("not installed");
  });

  it("caches the result after the first ok read", () => {
    let calls = 0;
    const readVersion = (): string => {
      calls += 1;
      return "wrangler 3.91.0";
    };
    assertWranglerVersion({ readVersion });
    assertWranglerVersion({ readVersion });
    assertWranglerVersion({ readVersion });
    expect(calls).toBe(1);
  });
});
