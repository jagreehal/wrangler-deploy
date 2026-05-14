import { describe, expect, it } from "vitest";
import { explainIssue } from "./explain.js";

describe("explainIssue", () => {
  it("explains 10000 account mismatch", () => {
    const result = explainIssue("API error 10000");
    expect(result.summary).toMatch(/account.*mismatch/i);
    expect(result.actions.join(" ")).toContain("CLOUDFLARE_ACCOUNT_ID");
  });

  it("explains missing stage state", () => {
    const result = explainIssue("No state found for stage dev");
    expect(result.summary).toContain("stage");
    expect(result.actions[0]).toContain("wd apply");
  });

  it("explains WD_E_* codes", () => {
    const result = explainIssue("WD_E_STATE_MISSING");
    expect(result.summary).toMatch(/provisioned|state/i);
  });

  it("explains additional WD_E_* codes", () => {
    expect(explainIssue("WD_E_AUTH_FAILED").summary).toMatch(/auth/i);
    expect(explainIssue("WD_E_CONFIG_MISSING").summary).toMatch(/config/i);
    expect(explainIssue("WD_E_NETWORK").summary).toMatch(/network/i);
  });

  it("lists known codes when called with no query", () => {
    const result = explainIssue("");
    expect(result.actions.some((line) => line.startsWith("WD_E_STATE_MISSING"))).toBe(true);
  });
});
