import { describe, expect, it } from "vitest";
import { outputSchemas, schemaForCommand } from "./output-schemas.js";

describe("outputSchemas", () => {
  it("includes key UX command schemas", () => {
    expect(outputSchemas.open.required).toContain("url");
    expect(outputSchemas.dashboard.required).toContain("opened");
    expect(outputSchemas.explain.required).toContain("actions");
    expect(outputSchemas.history.required).toContain("history");
    expect(outputSchemas.rollbackList.required).toContain("versions");
  });

  it("returns schema for a specific command", () => {
    expect(schemaForCommand("open")).toEqual(outputSchemas.open);
    expect(schemaForCommand("missing")).toBeUndefined();
  });
});
