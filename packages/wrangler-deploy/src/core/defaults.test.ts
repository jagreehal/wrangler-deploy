import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultUserStage } from "./defaults.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.WD_STAGE;
  delete process.env.USER;
  delete process.env.USERNAME;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("defaultUserStage", () => {
  it("uses WD_STAGE first when set", () => {
    process.env.WD_STAGE = "prod";
    process.env.USER = "alice";
    expect(defaultUserStage()).toBe("prod");
  });

  it("falls back to $USER on Unix", () => {
    process.env.USER = "alice";
    expect(defaultUserStage()).toBe("alice");
  });

  it("falls back to $USERNAME on Windows", () => {
    process.env.USERNAME = "Alice";
    expect(defaultUserStage()).toBe("alice");
  });

  it("returns 'dev' sentinel when no username is available", () => {
    expect(defaultUserStage()).toBe("dev");
  });

  it("sanitizes invalid characters into hyphens", () => {
    process.env.USER = "Jag.Reehal";
    expect(defaultUserStage()).toBe("jag-reehal");
  });

  it("collapses runs of invalid characters", () => {
    process.env.USER = "user@@@name";
    expect(defaultUserStage()).toBe("user-name");
  });

  it("strips leading and trailing hyphens", () => {
    process.env.USER = "@@user@@";
    expect(defaultUserStage()).toBe("user");
  });

  it("returns 'dev' when sanitized result is empty", () => {
    process.env.USER = "@@@";
    expect(defaultUserStage()).toBe("dev");
  });

  it("ignores blank WD_STAGE and falls through", () => {
    process.env.WD_STAGE = "   ";
    process.env.USER = "alice";
    expect(defaultUserStage()).toBe("alice");
  });
});
