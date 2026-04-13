import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { story } from "executable-stories-vitest";
import {
  callWorker,
  executeLocalD1,
  getD1Database,
  getQueueRoute,
  listD1Databases,
  listQueueRoutes,
  listWorkerRoutes,
  parseInterval,
  readDevLogSnapshot,
  readQueueTailSnapshot,
  replayQueueMessages,
  resolveD1CommandTarget,
  resolveWorkerCallTarget,
  resolveQueueSendTarget,
  runDevDoctor,
  sendQueueMessage,
  triggerCron,
} from "./runtime.js";
import { clearActiveDevState, resolveDevLogDir, writeActiveDevState } from "./dev-runtime-state.js";
import type { CfStageConfig } from "../types.js";

const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../apps/example");

const config: CfStageConfig = {
  version: 1,
  workers: ["workers/api", "workers/batch-workflow", "workers/event-router"],
  resources: {
    "payments-db": {
      type: "d1",
      bindings: {
        "workers/api": "DB",
        "workers/event-router": "DB",
      },
    },
    "payment-outbox": {
      type: "queue",
      bindings: {
        "workers/api": { producer: "OUTBOX_QUEUE" },
        "workers/batch-workflow": { producer: "OUTBOX_QUEUE" },
        "workers/event-router": { consumer: true },
      },
    },
    "payment-outbox-dlq": {
      type: "queue",
      bindings: {
        "workers/event-router": { deadLetterFor: "payment-outbox" },
      },
    },
  },
  dev: {
    endpoints: {
      health: {
        worker: "workers/api",
        path: "/health",
        method: "GET",
        description: "health check",
      },
    },
    d1: {
      "payments-db": {
        worker: "workers/api",
        seedFile: "sql/seed.sql",
        resetFile: "sql/reset.sql",
      },
    },
    queues: {
      "payment-outbox": {
        worker: "workers/api",
        path: "/debug/queues/payment-outbox",
      },
    },
    session: {
      entryWorker: "workers/api",
    },
    companions: [
      {
        name: "dev:cron",
        command: "pnpm dev:cron",
        cwd: ".",
        workers: ["workers/api"],
      },
    ],
  },
};

describe("runtime helpers", () => {
  it("lists queue topology from config bindings", ({ task }) => {
    story.init(task);
    story.given("a queue with two producers, one consumer, and a dead-letter queue");

    const routes = listQueueRoutes(config);

    story.then("the main queue exposes its producers and consumers");
    expect(routes).toContainEqual({
      logicalName: "payment-outbox",
      producers: [
        { workerPath: "workers/api", binding: "OUTBOX_QUEUE" },
        { workerPath: "workers/batch-workflow", binding: "OUTBOX_QUEUE" },
      ],
      consumers: [{ workerPath: "workers/event-router" }],
    });

    story.then("the dlq relationship can be inspected independently");
    expect(getQueueRoute(config, "payment-outbox-dlq")).toEqual({
      logicalName: "payment-outbox-dlq",
      producers: [],
      consumers: [],
      deadLetterFor: "payment-outbox",
    });
  });

  it("lists worker routes and named endpoints", async ({ task }) => {
    story.init(task);
    story.given("a named local endpoint configured for workers/api");

    clearActiveDevState(exampleRoot);
    const routes = await listWorkerRoutes(config, exampleRoot);

    story.then("the worker route summary includes the resolved local URL and endpoint");
    expect(routes.find((route) => route.workerPath === "workers/api")).toEqual({
      workerPath: "workers/api",
      port: 8787,
      url: "http://127.0.0.1:8787",
      endpoints: [
        {
          name: "health",
          path: "/health",
          method: "GET",
          description: "health check",
          url: "http://127.0.0.1:8787/health",
        },
      ],
    });
  });

  it("lists D1 databases and resolves a repo-aware command target", ({ task }) => {
    story.init(task);
    story.given("a D1 database bound in multiple workers with a configured default worker");

    expect(listD1Databases(config)).toContainEqual({
      logicalName: "payments-db",
      bindings: [
        { workerPath: "workers/api", binding: "DB" },
        { workerPath: "workers/event-router", binding: "DB" },
      ],
    });
    expect(getD1Database(config, "payments-db")?.bindings).toHaveLength(2);

    story.then("the configured worker is used for local D1 commands");
    expect(resolveD1CommandTarget(config, "/repo", { database: "payments-db" })).toEqual({
      database: "payments-db",
      workerPath: "workers/api",
      binding: "DB",
      cwd: "/repo/workers/api",
      wranglerArgs: ["d1", "execute", "payments-db", "--local"],
    });
  });

  it("parses simple duration strings for cron loop intervals", ({ task }) => {
    story.init(task);

    story.given("interval strings expressed in ms, seconds, and minutes");
    expect(parseInterval("500ms")).toBe(500);
    expect(parseInterval("5s")).toBe(5_000);
    expect(parseInterval("2m")).toBe(120_000);

    story.then("invalid values are rejected");
    expect(() => parseInterval("soon")).toThrow(/invalid interval/i);
  });

  it("triggers the local scheduled route with cron and time query params", async ({ task }) => {
    story.init(task);
    story.given("a running local dev server");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "cron processed",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerCron({
      port: 8787,
      cron: "* * * * *",
      time: "1745856238",
    });

    story.then("the documented scheduled handler route is called");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=1745856238"),
    );
    expect(result.body).toBe("cron processed");

    vi.unstubAllGlobals();
  });

  it("resolves queue send targets from dev queue config and posts payloads", async ({ task }) => {
    story.init(task);
    story.given("a configured local queue injection route for payment-outbox");

    const target = await resolveQueueSendTarget(config, "/repo", {
      queue: "payment-outbox",
      port: 8788,
    });

    story.then("the target points at the configured producer worker route");
    expect(target).toEqual({
      queue: "payment-outbox",
      workerPath: "workers/api",
      port: 8788,
      path: "/debug/queues/payment-outbox",
      url: "http://127.0.0.1:8788/debug/queues/payment-outbox",
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "queued",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendQueueMessage(config, "/repo", {
      queue: "payment-outbox",
      port: 8788,
      payload: JSON.stringify({ type: "batch.dispatched" }),
    });

    story.then("the payload is posted to the local debug route");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8788/debug/queues/payment-outbox", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "batch.dispatched" }),
    });
    expect(result.body).toBe("queued");

    vi.unstubAllGlobals();
  });

  it("resolves worker calls from worker path, port, path, and query string", async ({ task }) => {
    story.init(task);
    story.given("a local worker path with explicit query parameters");

    const target = await resolveWorkerCallTarget(config, "/repo", {
      worker: "workers/api",
      port: 8788,
      path: "/health",
      query: {
        source: "worker-call",
        mode: "test",
      },
    });

    story.then("the local worker URL is built from the active worker path");
    expect(target).toEqual({
      workerPath: "workers/api",
      port: 8788,
      path: "/health",
      url: "http://127.0.0.1:8788/health?source=worker-call&mode=test",
    });
  });

  it("calls a local worker with headers and body", async ({ task }) => {
    story.init(task);
    story.given("a running local worker endpoint");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({
        "content-type": "application/json",
        "x-worker": "api",
      }),
      text: async () => "{\"ok\":true}",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callWorker(config, "/repo", {
      worker: "workers/api",
      method: "post",
      port: 8788,
      path: "/dispatch",
      headers: {
        "content-type": "application/json",
        "x-request-id": "local-test",
      },
      body: JSON.stringify({ batchId: "abc" }),
    });

    story.then("the request is sent to the resolved local worker URL");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8788/dispatch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "local-test",
      },
      body: JSON.stringify({ batchId: "abc" }),
    });
    expect(result.status).toBe(202);
    expect(result.headers["x-worker"]).toBe("api");

    vi.unstubAllGlobals();
  });

  it("calls a named worker endpoint with its configured path and method", async ({ task }) => {
    story.init(task);
    story.given("a named endpoint in dev.endpoints");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => "ok",
    });
    vi.stubGlobal("fetch", fetchMock);

    await callWorker(config, exampleRoot, {
      worker: "workers/api",
      endpoint: "health",
      port: 8788,
      query: { source: "named-endpoint" },
    });

    story.then("the endpoint path and configured method are used");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8788/health?source=named-endpoint",
      { method: "GET", headers: undefined, body: undefined },
    );

    vi.unstubAllGlobals();
  });

  it("executes local D1 commands via the wrangler runner", ({ task }) => {
    story.init(task);
    story.given("a local SQL statement against payments-db");

    const wrangler = {
      run: vi.fn().mockReturnValue("Executed 1 command."),
    };

    const result = executeLocalD1(config, "/repo", wrangler, {
      database: "payments-db",
      sql: "SELECT 1",
    });

    story.then("the repo-aware target is converted to wrangler d1 execute --local");
    expect(wrangler.run).toHaveBeenCalledWith(
      ["d1", "execute", "payments-db", "--local", "--command", "SELECT 1"],
      "/repo/workers/api",
      { localOnly: true },
    );
    expect(result.output).toBe("Executed 1 command.");
  });

  it("replays multiple queue payloads through the same target", async ({ task }) => {
    story.init(task);
    story.given("a payload fixture with two queue messages");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "queued-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "queued-2",
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await replayQueueMessages(config, "/repo", {
      queue: "payment-outbox",
      port: 8788,
      payloads: [
        JSON.stringify({ type: "batch.dispatched", data: { batchId: "a" } }),
        JSON.stringify({ type: "batch.dispatched", data: { batchId: "b" } }),
      ],
    });

    story.then("both payloads are POSTed to the same injection route");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(2);
    expect(result.results.map((entry) => entry.body)).toEqual(["queued-1", "queued-2"]);

    vi.unstubAllGlobals();
  });

  it("runs dev doctor checks for entry workers, companions, and queues", async ({ task }) => {
    story.init(task);
    story.given("a valid local runtime configuration");

    const checks = await runDevDoctor(config, exampleRoot, {
      workerExists: () => true,
      readWorkerConfig: () => ({ name: "worker", triggers: { crons: ["*/5 * * * *"] } }),
      pathExists: () => true,
    });

    story.then("entry worker, companion cwd, cron, and queue checks all pass");
    expect(checks.find((check) => check.name === "dev session entry worker")?.status).toBe("pass");
    expect(checks.find((check) => check.name === "companion cwd: dev:cron")?.status).toBe("pass");
    expect(checks.find((check) => check.name === "cron route: workers/api")?.status).toBe("pass");
    expect(checks.find((check) => check.name === "queue route: payment-outbox")?.status).toBe("pass");
    expect(checks.find((check) => check.name === "queue: payment-outbox")?.status).toBe("pass");
  });

  it("reads queue tail snapshots from the active dev runtime log files", ({ task }) => {
    story.init(task);
    story.given("an active dev runtime state with a consumer log file");

    const rootDir = mkdtempSync(join(tmpdir(), "wd-runtime-"));
    const logDir = resolveDevLogDir(rootDir);
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "workers__event-router.log");
    writeFileSync(logFile, "[queue:payment-outbox] batch.dispatched\n");
    writeActiveDevState(rootDir, {
      mode: "workers",
      ports: { "workers/event-router": 8789 },
      workers: ["workers/event-router"],
      logFiles: {
        "workers/event-router": logFile,
      },
      updatedAt: new Date().toISOString(),
      pid: process.pid,
    });

    const snapshots = readQueueTailSnapshot(config, rootDir, {
      queue: "payment-outbox",
      worker: "workers/event-router",
    });

    story.then("the consumer log content is returned for queue tailing");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.content).toContain("batch.dispatched");
  });

  it("reads filtered worker log snapshots from the active dev runtime", ({ task }) => {
    story.init(task);
    story.given("an active runtime log with multiple lines");

    const rootDir = mkdtempSync(join(tmpdir(), "wd-runtime-"));
    const logDir = resolveDevLogDir(rootDir);
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "workers__api.log");
    writeFileSync(logFile, "[wrangler:info] GET /health 200 OK\n[queue:payment-outbox] sent\n");
    writeActiveDevState(rootDir, {
      mode: "workers",
      ports: { "workers/api": 8787 },
      workers: ["workers/api"],
      logFiles: {
        "workers/api": logFile,
      },
      updatedAt: new Date().toISOString(),
      pid: process.pid,
    });

    const snapshots = readDevLogSnapshot(config, rootDir, {
      worker: "workers/api",
      grep: "queue",
    });

    story.then("only matching lines are returned");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.content).toBe("[queue:payment-outbox] sent");
  });
});
