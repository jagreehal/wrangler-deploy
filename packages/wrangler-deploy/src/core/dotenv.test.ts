import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnvFile, loadEnvFileFromArgs, parseDotenv } from "./dotenv.js";

const ORIGINAL_ENV = { ...process.env };
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wd-dotenv-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
});

describe("parseDotenv", () => {
  it("parses simple KEY=value pairs", () => {
    const result = parseDotenv("FOO=bar\nBAZ=qux");
    expect(result.values).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(result.errors).toEqual([]);
  });

  it("ignores blank lines and comments", () => {
    const result = parseDotenv("# comment\n\nFOO=bar\n# another\n");
    expect(result.values).toEqual({ FOO: "bar" });
  });

  it("supports export prefix", () => {
    const result = parseDotenv("export FOO=bar");
    expect(result.values).toEqual({ FOO: "bar" });
  });

  it("preserves double-quoted values and decodes escapes", () => {
    const result = parseDotenv('GREETING="hello\\nworld"');
    expect(result.values.GREETING).toBe("hello\nworld");
  });

  it("preserves single-quoted values literally", () => {
    const result = parseDotenv("LITERAL='hello\\nworld'");
    expect(result.values.LITERAL).toBe("hello\\nworld");
  });

  it("strips inline comments from unquoted values", () => {
    const result = parseDotenv("FOO=bar # trailing comment");
    expect(result.values.FOO).toBe("bar");
  });

  it("does not strip # inside quoted values", () => {
    const result = parseDotenv('FOO="bar # not a comment"');
    expect(result.values.FOO).toBe("bar # not a comment");
  });

  it("reports errors for malformed lines", () => {
    const result = parseDotenv("missing-equals\nVALID=ok");
    expect(result.values).toEqual({ VALID: "ok" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(1);
  });

  it("rejects invalid keys", () => {
    const result = parseDotenv("1BAD=value");
    expect(result.errors).toHaveLength(1);
  });
});

describe("loadEnvFile", () => {
  it("populates process.env with parsed values", () => {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "FOO=from-file\n");
    delete process.env.FOO;
    loadEnvFile(envPath);
    expect(process.env.FOO).toBe("from-file");
  });

  it("does not override existing process.env vars by default", () => {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "FOO=from-file\n");
    process.env.FOO = "from-shell";
    loadEnvFile(envPath);
    expect(process.env.FOO).toBe("from-shell");
  });

  it("overrides when override=true", () => {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "FOO=from-file\n");
    process.env.FOO = "from-shell";
    loadEnvFile(envPath, { override: true });
    expect(process.env.FOO).toBe("from-file");
  });

  it("throws when the file does not exist", () => {
    expect(() => loadEnvFile(join(tmpDir, "nope"))).toThrow(/env file not found/);
  });
});

describe("loadEnvFileFromArgs", () => {
  it("returns null when --env-file is not present", () => {
    const result = loadEnvFileFromArgs(["plan", "--stage", "dev"], tmpDir);
    expect(result).toBeNull();
  });

  it("loads when flag is provided with a path", () => {
    const envPath = join(tmpDir, ".env.staging");
    writeFileSync(envPath, "API_KEY=secret\n");
    delete process.env.API_KEY;
    const result = loadEnvFileFromArgs(["deploy", "--env-file", ".env.staging"], tmpDir);
    expect(result).not.toBeNull();
    expect(result?.loaded).toBe(1);
    expect(process.env.API_KEY).toBe("secret");
  });

  it("throws when --env-file has no value", () => {
    expect(() =>
      loadEnvFileFromArgs(["deploy", "--env-file", "--stage"], tmpDir),
    ).toThrow(/--env-file requires a path/);
  });

  it("surfaces parse errors with line numbers", () => {
    const envPath = join(tmpDir, ".env.bad");
    writeFileSync(envPath, "GOOD=ok\nbad-line\n");
    expect(() => loadEnvFileFromArgs(["deploy", "--env-file", ".env.bad"], tmpDir))
      .toThrow(/line 2/);
  });
});
