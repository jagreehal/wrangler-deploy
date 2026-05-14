import { describe, expect, it, vi } from "vitest";
import { getOpenCommand, openUrl } from "./open-url.js";

describe("open-url", () => {
  it("uses macOS open on darwin", () => {
    expect(getOpenCommand("darwin")).toEqual({ command: "open", argsPrefix: [] });
  });

  it("uses Windows start via cmd on win32", () => {
    expect(getOpenCommand("win32")).toEqual({ command: "cmd", argsPrefix: ["/c", "start", ""] });
  });

  it("uses xdg-open on linux", () => {
    expect(getOpenCommand("linux")).toEqual({ command: "xdg-open", argsPrefix: [] });
  });

  it("invokes runner with platform command and target URL", () => {
    const runner = vi.fn();
    openUrl("https://example.com", { platform: "linux", runner });
    expect(runner).toHaveBeenCalledWith("xdg-open", ["https://example.com"]);
  });
});
