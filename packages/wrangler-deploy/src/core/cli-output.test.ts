import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseOutputFields,
  parseOutputFormat,
  printJson,
  redactSensitiveText,
  setJsonOutputOptions,
} from "./cli-output.js";

afterEach(() => {
  setJsonOutputOptions({});
});

describe("cli-output", () => {
  it("detects json output from either --json or --format json", () => {
    expect(parseOutputFormat(["plan", "--json"])).toBe("json");
    expect(parseOutputFormat(["plan", "--format", "json"])).toBe("json");
    expect(parseOutputFormat(["plan", "--ndjson"])).toBe("json");
    expect(parseOutputFormat(["plan"])).toBe("text");
  });

  it("parses field filters from repeated and comma-separated flags", () => {
    expect(parseOutputFields(["plan", "--fields", "id,name", "--fields", "config.value"])).toEqual([
      "id",
      "name",
      "config.value",
    ]);
  });

  it("prints ndjson and applies field selection", () => {
    const write = vi.spyOn(process.stdout, "write");
    const output: string[] = [];
    write.mockImplementation(((chunk: string | Uint8Array) => {
      output.push(chunk.toString());
      return true;
    }) as never);

    setJsonOutputOptions({ fields: ["id", "nested.value"], ndjson: true });
    printJson([
      { id: 1, name: "alpha", nested: { value: "a", extra: "ignored" } },
      { id: 2, name: "beta", nested: { value: "b" } },
    ]);

    expect(output.join("")).toBe(
      '{"id":1,"nested":{"value":"a"}}\n{"id":2,"nested":{"value":"b"}}\n',
    );
    write.mockRestore();
  });

  it("redacts long token-like strings from error text", () => {
    expect(redactSensitiveText("token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"))
      .toContain("[REDACTED]");
  });
});
