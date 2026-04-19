import { describe, expect, it, vi } from "vitest";
import type { ExecFileSyncFn } from "./migrate.js";
import { runMigrations } from "./migrate.js";

const GUARD_DIR = "/pkg/guard";
const DB_ID = "ae724c8a-4cb3-4aa0-934c-2b80f0097f53";
const TEMPLATE = `{ "d1_databases": [{ "database_id": "REPLACE_WITH_D1_ID" }] }`;

describe("runMigrations", () => {
  it("calls wrangler d1 migrations apply with correct args", () => {
    const execFileSync = vi.fn().mockReturnValue("Applied 1 migration");
    runMigrations(
      { guardDir: GUARD_DIR, databaseId: DB_ID },
      {
        execFileSync: execFileSync as unknown as ExecFileSyncFn,
        readFileSync: () => TEMPLATE,
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      }
    );
    const [cmd, args] = execFileSync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("wrangler");
    expect(args).toContain("d1");
    expect(args).toContain("migrations");
    expect(args).toContain("apply");
    expect(args).toContain("workers-usage-guard");
    expect(args).toContain("--remote");
    expect(args).toContain("--config");
  });

  it("returns output from wrangler", () => {
    const execFileSync = vi.fn().mockReturnValue("Applied 2 migrations");
    const result = runMigrations(
      { guardDir: GUARD_DIR, databaseId: DB_ID },
      {
        execFileSync: execFileSync as unknown as ExecFileSyncFn,
        readFileSync: () => TEMPLATE,
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      }
    );
    expect(result.output).toBe("Applied 2 migrations");
  });

  it("throws when wrangler exits non-zero", () => {
    const execFileSync = vi.fn().mockImplementation(() => {
      throw new Error("wrangler: database not found");
    });
    expect(() =>
      runMigrations(
        { guardDir: GUARD_DIR, databaseId: DB_ID },
        {
          execFileSync: execFileSync as unknown as ExecFileSyncFn,
          readFileSync: () => TEMPLATE,
          writeFileSync: vi.fn(),
          unlinkSync: vi.fn(),
        }
      )
    ).toThrow("wrangler: database not found");
  });
});
