import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { story } from "executable-stories-vitest";
import { generateConfig } from "./init.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wd-init-"));
  tempDirs.push(dir);
  return dir;
}

describe("generateConfig", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers workers and generates resources, envs, and service bindings", ({ task }) => {
    story.init(task);

    story.given("a monorepo with an API worker and a router worker");
    const rootDir = makeTempDir();
    const apiDir = join(rootDir, "apps/api");
    const routerDir = join(rootDir, "apps/router");

    mkdirSync(apiDir, { recursive: true });
    mkdirSync(routerDir, { recursive: true });

    writeFileSync(
      join(apiDir, "wrangler.jsonc"),
      JSON.stringify({
        name: "payment-api",
        kv_namespaces: [{ binding: "TOKEN_KV", id: "kv-id" }],
        hyperdrive: [{ binding: "PAYMENTS_DB", id: "hyper-id" }],
        queues: {
          producers: [{ binding: "OUTBOX_QUEUE", queue: "payment-outbox" }],
        },
        services: [{ binding: "WORKFLOW", service: "payment-router" }],
      })
    );

    writeFileSync(
      join(routerDir, "wrangler.jsonc"),
      JSON.stringify({
        name: "payment-router",
        queues: {
          consumers: [{ queue: "payment-outbox", dead_letter_queue: "payment-outbox-dlq" }],
        },
      })
    );

    story.when("generateConfig scans the repo");
    const output = generateConfig(rootDir);

    story.then("output contains worker paths and resource declarations");
    expect(output).toContain(`"apps/api"`);
    expect(output).toContain(`"apps/router"`);
    // Resource declarations with safe variable names
    expect(output).toContain(`const tokenKv = kv("token-kv");`);
    expect(output).toContain(`const paymentsDbDb = hyperdrive("payments-db");`);
    expect(output).toContain(`const paymentOutbox = queue("payment-outbox");`);
    expect(output).toContain(`const paymentOutboxDlq = queue("payment-outbox-dlq");`);
    expect(output).toContain(`const paymentRouterWorker = worker("payment-router");`);

    story.and("worker env exports include all bindings");
    expect(output).toContain(`export const paymentApiEnv = workerEnv({`);
    expect(output).toContain(`  TOKEN_KV: tokenKv,`);
    expect(output).toContain(`  PAYMENTS_DB: paymentsDbDb,`);
    expect(output).toContain(`  OUTBOX_QUEUE: paymentOutbox,`);
    expect(output).toContain(`  WORKFLOW: paymentRouterWorker,`);

    story.and("config structure includes service bindings and stage rules");
    expect(output).toContain(`"apps/api": {`);
    expect(output).toContain(`WORKFLOW: "apps/router",`);
    expect(output).toContain(`"pr-*": { protected: false, ttl: "7d" }`);
  });

  it("skips ignored directories while scanning", ({ task }) => {
    story.init(task);

    story.given("a repo with a valid worker and a wrangler.jsonc inside node_modules");
    const rootDir = makeTempDir();
    const appDir = join(rootDir, "apps/api");
    const ignoredDir = join(rootDir, "node_modules/pkg");

    mkdirSync(appDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });

    writeFileSync(join(appDir, "wrangler.jsonc"), JSON.stringify({ name: "api" }));
    writeFileSync(join(ignoredDir, "wrangler.jsonc"), JSON.stringify({ name: "ignored" }));

    story.when("generateConfig scans the repo");
    const output = generateConfig(rootDir);

    story.then("only the real worker is discovered");
    expect(output).toContain(`"apps/api"`);
    expect(output).not.toContain(`node_modules/pkg`);
    expect(output).not.toContain(`ignored`);
  });

  it("preserves both producer and consumer roles when one worker does both for the same queue", ({ task }) => {
    story.init(task);

    story.given("a worker that both produces to and consumes from one queue");
    const rootDir = makeTempDir();
    const workerDir = join(rootDir, "apps/router");

    mkdirSync(workerDir, { recursive: true });

    writeFileSync(
      join(workerDir, "wrangler.jsonc"),
      JSON.stringify({
        name: "payment-router",
        queues: {
          producers: [{ binding: "OUTBOX_QUEUE", queue: "payment-outbox" }],
          consumers: [{ queue: "payment-outbox" }],
        },
      }),
    );

    story.when("generateConfig scans the repo");
    const output = generateConfig(rootDir);

    story.then("the generated queue binding should preserve both roles");
    expect(output).toContain(`"apps/router": { producer: "OUTBOX_QUEUE", consumer: true }`);
  });
});
