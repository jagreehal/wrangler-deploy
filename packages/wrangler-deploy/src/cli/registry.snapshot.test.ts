import { describe, expect, it } from "vitest";
import { getRegistry } from "./registry.js";

describe("wd actions sitemap snapshot", () => {
  it("matches the recorded sitemap", () => {
    // We compare a stripped-down projection: name, summary, category, requires,
    // mutating, and next. Flag descriptions / examples are excluded to keep
    // the snapshot stable across copy edits.
    const projection = getRegistry().map((a) => ({
      name: a.name,
      summary: a.summary,
      category: a.category,
      requires: a.requires,
      mutating: a.mutating,
      next: a.next,
    }));
    expect(projection).toMatchSnapshot();
  });
});
