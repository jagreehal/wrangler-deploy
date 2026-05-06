import { describe, expect, it } from "vitest";
import {
  dashboardCreateUrl,
  REQUIRED_SCOPES,
  renderTokenInstructions,
  tokenInstructionsJson,
} from "./cf-token.js";

describe("required scopes", () => {
  it("includes the core write scopes", () => {
    const groups = REQUIRED_SCOPES.map((scope) => scope.group);
    expect(groups).toContain("Workers Scripts");
    expect(groups).toContain("D1");
    expect(groups).toContain("Queues");
    expect(groups).toContain("Workers KV Storage");
    expect(groups).toContain("Workers R2 Storage");
  });

  it("uses only Read or Edit levels", () => {
    for (const scope of REQUIRED_SCOPES) {
      expect(["Read", "Edit"]).toContain(scope.level);
    }
  });
});

describe("dashboardCreateUrl", () => {
  it("points at the Cloudflare token creation page", () => {
    const url = dashboardCreateUrl();
    expect(url.startsWith("https://dash.cloudflare.com/profile/api-tokens")).toBe(true);
    expect(url).toContain("name=wrangler-deploy");
  });
});

describe("renderTokenInstructions", () => {
  it("includes all required scope groups in human output", () => {
    const text = renderTokenInstructions();
    for (const scope of REQUIRED_SCOPES) {
      expect(text).toContain(scope.group);
    }
    expect(text).toContain(dashboardCreateUrl());
    expect(text).toContain("wd login");
  });

  it("emits profile-aware login command for non-default profiles", () => {
    const text = renderTokenInstructions({ profileName: "prod" });
    expect(text).toContain("wd login --profile prod");
  });

  it("emits bare login for the default profile", () => {
    const text = renderTokenInstructions({ profileName: "default" });
    expect(text).toMatch(/^\s+wd login\s*$/m);
  });
});

describe("tokenInstructionsJson", () => {
  it("returns scopes plus dashboard URL plus login command", () => {
    const json = tokenInstructionsJson({ profileName: "prod" });
    expect(json.scopes).toEqual(REQUIRED_SCOPES);
    expect(json.dashboardUrl).toBe(dashboardCreateUrl());
    expect(json.loginCommand).toBe("wd login --profile prod");
  });
});
