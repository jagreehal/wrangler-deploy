import { describe, expect, it, vi } from "vitest";
import type { ExecFileSyncFn } from "./deploy.js";
import { deployGuard } from "./deploy.js";

describe("deployGuard", () => {
  it("calls wrangler deploy with correct args", () => {
    const execFileSync = vi.fn().mockReturnValue("Deployed to https://workers-usage-guard.example.workers.dev");
    deployGuard(
      { guardDir: "/pkg/guard", databaseId: "db-abc123" },
      {
        execFileSync: execFileSync as unknown as ExecFileSyncFn,
        readFileSync: () => '{"d1_databases":[{"database_id":"REPLACE_WITH_D1_ID"}]}',
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      }
    );
    expect(execFileSync).toHaveBeenCalledOnce();
    const [cmd, args, opts] = execFileSync.mock.calls[0] as [string, string[], { cwd: string }];
    expect(cmd).toBe("wrangler");
    expect(args).toContain("deploy");
    expect(args).toContain("--config");
    expect(opts.cwd).toBe("/pkg/guard");
  });

  it("replaces REPLACE_WITH_D1_ID in the temp wrangler config", () => {
    const writtenContent: string[] = [];
    const execFileSync = vi.fn().mockReturnValue("Deployed");
    deployGuard(
      { guardDir: "/pkg/guard", databaseId: "test-db-id" },
      {
        execFileSync: execFileSync as unknown as ExecFileSyncFn,
        writeFileSync: (_, content) => { writtenContent.push(content as string); },
        unlinkSync: vi.fn(),
        readFileSync: () => '{"d1_databases":[{"database_id":"REPLACE_WITH_D1_ID"}]}',
      }
    );
    expect(writtenContent[0]).toContain("test-db-id");
    expect(writtenContent[0]).not.toContain("REPLACE_WITH_D1_ID");
  });

  it("parses the deployed worker URL from wrangler output", () => {
    const execFileSync = vi.fn().mockReturnValue(
      "✓ Uploaded workers-usage-guard\nhttps://workers-usage-guard.my-account.workers.dev\n"
    );
    const result = deployGuard(
      { guardDir: "/pkg/guard", databaseId: "db-abc123" },
      {
        execFileSync: execFileSync as unknown as ExecFileSyncFn,
        readFileSync: () => '{"d1_databases":[{"database_id":"REPLACE_WITH_D1_ID"}]}',
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      }
    );
    expect(result.workerUrl).toBe("https://workers-usage-guard.my-account.workers.dev");
  });

  it("returns undefined workerUrl when URL cannot be parsed", () => {
    const execFileSync = vi.fn().mockReturnValue("Some other output");
    const result = deployGuard(
      { guardDir: "/pkg/guard", databaseId: "db-abc123" },
      {
        execFileSync: execFileSync as unknown as ExecFileSyncFn,
        readFileSync: () => '{"d1_databases":[{"database_id":"REPLACE_WITH_D1_ID"}]}',
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      }
    );
    expect(result.workerUrl).toBeUndefined();
  });
});
