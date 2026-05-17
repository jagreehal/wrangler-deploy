import { describe, expect, it } from "vitest";
import {
  closestConcept,
  getConcept,
  listConcepts,
  _resetConceptCache,
} from "./explain-concepts.js";

describe("explain-concepts", () => {
  it("loads at least the core concepts", () => {
    _resetConceptCache();
    const names = listConcepts().map((c) => c.name);
    for (const expected of ["stages", "bindings", "rendered-configs", "state", "resources", "workers", "hypermedia"]) {
      expect(names, `missing concept: ${expected}`).toContain(expected);
    }
  });

  it("each concept ends with a `See also` section so the graph closes", () => {
    for (const concept of listConcepts()) {
      const body = getConcept(concept.name)?.body ?? "";
      expect(body, `${concept.name} missing See also`).toMatch(/See also/);
    }
  });

  it("each concept has a non-empty summary derived from the markdown", () => {
    for (const concept of listConcepts()) {
      expect(concept.summary.length, `${concept.name} summary empty`).toBeGreaterThan(10);
    }
  });

  it("closestConcept suggests near matches", () => {
    const names = listConcepts().map((c) => c.name);
    expect(closestConcept("stage", names)).toBe("stages");
    expect(closestConcept("rendered_config", names)).toBe("rendered-configs");
  });

  it("closestConcept returns undefined for nonsense", () => {
    const names = listConcepts().map((c) => c.name);
    expect(closestConcept("qqqqqqqqqq", names)).toBeUndefined();
  });
});
