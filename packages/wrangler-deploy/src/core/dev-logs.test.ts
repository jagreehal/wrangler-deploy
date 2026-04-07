import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { createLogMultiplexer } from "./dev-logs.js";

describe("createLogMultiplexer", () => {
  it("prefixes lines with the worker label", ({ task }) => {
    story.init(task);

    const lines: string[] = [];
    const mux = createLogMultiplexer((line) => lines.push(line));

    story.given("a writer for apps/api");
    const write = mux.createWriter("apps/api");

    story.when("a line of output is written");
    write("Hello world");

    story.then("the output is prefixed with the worker label");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("api");
    expect(lines[0]).toContain("Hello world");
  });

  it("different workers get different prefixes", ({ task }) => {
    story.init(task);

    const lines: string[] = [];
    const mux = createLogMultiplexer((line) => lines.push(line));

    story.given("writers for apps/api and apps/worker");
    const writeApi = mux.createWriter("apps/api");
    const writeWorker = mux.createWriter("apps/worker");

    story.when("each writes a line");
    writeApi("from api");
    writeWorker("from worker");

    story.then("the prefixes are visually distinct");
    expect(lines[0]).toContain("api");
    expect(lines[1]).toContain("worker");
    // Prefixes should be different (different color codes or labels)
    const prefixApi = lines[0]!.replace("from api", "");
    const prefixWorker = lines[1]!.replace("from worker", "");
    expect(prefixApi).not.toBe(prefixWorker);
  });

  it("multi-line output splits into individually prefixed lines", ({ task }) => {
    story.init(task);

    const lines: string[] = [];
    const mux = createLogMultiplexer((line) => lines.push(line));

    story.given("a writer for apps/auth");
    const write = mux.createWriter("apps/auth");

    story.when("multi-line data is written at once");
    write("line one\nline two\nline three");

    story.then("each line is emitted separately with the prefix");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).toContain("auth");
    }
    expect(lines[0]).toContain("line one");
    expect(lines[1]).toContain("line two");
    expect(lines[2]).toContain("line three");
  });

  it("optionally persists plain logs to files", ({ task }) => {
    story.init(task);

    const lines: string[] = [];
    const logDir = mkdtempSync(join(tmpdir(), "wd-logs-"));
    const mux = createLogMultiplexer((line) => lines.push(line), { logDir });

    story.given("a writer for workers/event-router with log persistence enabled");
    const write = mux.createWriter("workers/event-router");

    story.when("a line is written");
    write("tail me");

    story.then("the line is also written to the target log file without ansi prefixes");
    const content = readFileSync(join(logDir, "workers__event-router.log"), "utf-8");
    expect(content).toContain("tail me");
    expect(content).not.toContain("[event-router");
    expect(lines[0]).toContain("tail me");
  });
});
