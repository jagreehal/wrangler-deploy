import { describe, expect, it } from "vitest";
import type { ResourceProps } from "../types.js";
import { classifyReplacement, describeReplacement } from "./replacement.js";

function props(over: Partial<ResourceProps> & Pick<ResourceProps, "type" | "name">): ResourceProps {
  return { bindings: {}, ...over };
}

describe("classifyReplacement", () => {
  it("reports no replacement needed when only bindings change", () => {
    const oldP = props({ type: "kv", name: "cache-dev", bindings: { "apps/api": "CACHE" } });
    const newP = props({
      type: "kv",
      name: "cache-dev",
      bindings: { "apps/api": "CACHE", "apps/worker": "CACHE" },
    });
    const verdict = classifyReplacement("kv", oldP, newP);
    expect(verdict.required).toBe(false);
  });

  it("flags name change as a replacement on KV", () => {
    const oldP = props({ type: "kv", name: "cache-dev" });
    const newP = props({ type: "kv", name: "cache-prod" });
    const verdict = classifyReplacement("kv", oldP, newP);
    expect(verdict.required).toBe(true);
    expect(verdict.reasons[0]).toContain("name:");
  });

  it("flags Vectorize dimension change as a replacement", () => {
    const oldP = props({ type: "vectorize", name: "idx", dimensions: 768 });
    const newP = props({ type: "vectorize", name: "idx", dimensions: 1024 });
    const verdict = classifyReplacement("vectorize", oldP, newP);
    expect(verdict.required).toBe(true);
    expect(verdict.reasons[0]).toContain("dimensions");
  });

  it("flags Hyperdrive database struct change", () => {
    const oldP = props({
      type: "hyperdrive",
      name: "pg",
      database: { provider: "neon", branchFrom: "main" },
    });
    const newP = props({
      type: "hyperdrive",
      name: "pg",
      database: { provider: "neon", branchFrom: "next" },
    });
    const verdict = classifyReplacement("hyperdrive", oldP, newP);
    expect(verdict.required).toBe(true);
    expect(verdict.reasons[0]).toContain("database");
  });

  it("ignores DNS resources (they reconcile per-record without replacement)", () => {
    const oldP = props({ type: "dns", name: "zone-dev" });
    const newP = props({ type: "dns", name: "zone-prod" });
    expect(classifyReplacement("dns", oldP, newP).required).toBe(false);
  });

  it("describeReplacement returns undefined when no change forces it", () => {
    expect(
      describeReplacement({ required: false, reasons: [] }),
    ).toBeUndefined();
  });

  it("describeReplacement summarises the reasons", () => {
    expect(
      describeReplacement({
        required: true,
        reasons: ['name: "old" → "new"'],
      }),
    ).toBe('requires replacement: name: "old" → "new"');
  });
});
