import { describe, expect, it } from "vitest";
import { getClipboardCommand } from "./clipboard.js";

describe("getClipboardCommand", () => {
  it("returns pbcopy on darwin", () => {
    expect(getClipboardCommand("darwin")).toEqual({ command: "pbcopy", args: [] });
  });

  it("returns cmd clip on win32", () => {
    expect(getClipboardCommand("win32")).toEqual({ command: "cmd", args: ["/c", "clip"] });
  });

  it("returns xclip on linux", () => {
    expect(getClipboardCommand("linux")).toEqual({ command: "xclip", args: ["-selection", "clipboard"] });
  });
});
