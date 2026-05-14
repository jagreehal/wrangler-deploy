import { describe, expect, it } from "vitest";
import { codeForDoctorCheck } from "./doctor-codes.js";

describe("codeForDoctorCheck", () => {
  it("maps wrangler check to specific code", () => {
    const code = codeForDoctorCheck({
      name: "wrangler installed",
      status: "fail",
      message: "wrangler not found",
    });
    expect(code.id).toBe("WD_DOC_WRANGLER_MISSING");
  });

  it("maps unknown checks to generic code", () => {
    const code = codeForDoctorCheck({
      name: "something else",
      status: "warn",
      message: "warn",
    });
    expect(code.id).toBe("WD_DOC_GENERIC");
  });
});
