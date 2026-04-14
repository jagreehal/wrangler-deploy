import { vi, describe, expect, it, beforeEach } from "vitest";
import { story } from "executable-stories-vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../core/auth.js", () => ({
  getWranglerEnv: vi.fn(() => ({ ...process.env })),
  resolveAccountId: vi.fn(() => "fake-account-id"),
}));

import { execFileSync } from "node:child_process";
import { createD1Database } from "./d1.js";
import { createR2Bucket } from "./r2.js";
import { createVectorizeIndex } from "./vectorize.js";

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecFileSync.mockReset();
});

describe("local CLI-backed providers", () => {
  it("returns a typed D1Output with the extracted database id", ({ task }) => {
    story.init(task);

    story.given("wrangler output containing a D1 database UUID");
    mockExecFileSync.mockReturnValue(
      'Created DB.\n[[d1_databases]]\nid = "123e4567-e89b-12d3-a456-426614174000"',
    );

    story.when("createD1Database is called with a name and cwd");
    const result = createD1Database("my-db", "/cwd");

    story.then("the returned struct contains the extracted id, name, and version");
    expect(result).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "my-db",
      version: "v1",
    });
  });

  it("returns a typed R2Output with the bucket name", ({ task }) => {
    story.init(task);

    story.given("wrangler output for an R2 bucket creation");
    mockExecFileSync.mockReturnValue("Created bucket my-bucket.");

    story.when("createR2Bucket is called with a name and cwd");
    const result = createR2Bucket("my-bucket", "/cwd");

    story.then("the returned struct contains the bucket name");
    expect(result).toMatchObject({ name: "my-bucket" });
  });

  it("returns a typed VectorizeOutput with the index metadata", ({ task }) => {
    story.init(task);

    story.given("wrangler output containing a Vectorize index UUID");
    mockExecFileSync.mockReturnValue(
      'Created index.\nid = "abc12345-0000-0000-0000-000000000000"',
    );

    story.when("createVectorizeIndex is called with a name, config, and cwd");
    const result = createVectorizeIndex(
      "my-index",
      { dimensions: 768, metric: "cosine" },
      "/cwd",
    );

    story.then("the returned struct contains the name, dimensions, and metric");
    expect(result).toMatchObject({
      name: "my-index",
      dimensions: 768,
      metric: "cosine",
    });
  });
});
