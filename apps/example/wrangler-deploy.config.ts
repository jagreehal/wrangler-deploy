import { defineConfig, kv, queue, d1, worker, workerEnv } from "wrangler-deploy";

// Resources — all fully managed by Cloudflare, no external dependencies
const db = d1("payments-db");
const tokenKv = kv("token-kv");
const cacheKv = kv("cache-kv");
const paymentOutbox = queue("payment-outbox");
const _paymentOutboxDlq = queue("payment-outbox-dlq");
const paymentBatchWorkflowWorker = worker("payment-batch-workflow");

// Worker environments — phantom types, zero codegen

export const paymentApiEnv = workerEnv({
  DB: db,
  TOKEN_KV: tokenKv,
  OUTBOX_QUEUE: paymentOutbox,
  WORKFLOWS: paymentBatchWorkflowWorker,
});

export const paymentBatchWorkflowEnv = workerEnv({
  DB: db,
  CACHE_KV: cacheKv,
  OUTBOX_QUEUE: paymentOutbox,
});

export const paymentEventRouterEnv = workerEnv({
  DB: db,
  OUTBOX_QUEUE: paymentOutbox,
});

export default defineConfig({
  version: 1,

  workers: ["workers/api", "workers/batch-workflow", "workers/event-router"],

  // deployOrder inferred from serviceBindings

  resources: {
    "payments-db": {
      type: "d1",
      bindings: {
        "workers/api": "DB",
        "workers/batch-workflow": "DB",
        "workers/event-router": "DB",
      },
    },
    "token-kv": {
      type: "kv",
      bindings: {
        "workers/api": "TOKEN_KV",
      },
    },
    "cache-kv": {
      type: "kv",
      bindings: {
        "workers/batch-workflow": "CACHE_KV",
      },
    },
    "payment-outbox": {
      type: "queue",
      bindings: {
        "workers/api": { producer: "OUTBOX_QUEUE" },
        "workers/batch-workflow": { producer: "OUTBOX_QUEUE" },
        "workers/event-router": { producer: "OUTBOX_QUEUE", consumer: true },
      },
    },
    "payment-outbox-dlq": {
      type: "queue",
      bindings: {
        "workers/event-router": { deadLetterFor: "payment-outbox" },
      },
    },
  },

  serviceBindings: {
    "workers/api": {
      WORKFLOWS: "workers/batch-workflow",
    },
  },

  fixtures: {
    "api-health": {
      type: "worker",
      worker: "workers/api",
      endpoint: "health",
      description: "Shared health check for worker calls and local verification",
    },
    "echo-ping": {
      type: "worker",
      worker: "workers/api",
      endpoint: "echo",
      query: {
        source: "fixture",
      },
      headers: {
        "x-request-id": "fixture-echo",
      },
      body: JSON.stringify({ ping: true }),
      description: "Exercise the local echo endpoint with a standard payload",
    },
    "payment-outbox-dispatch": {
      type: "queue",
      queue: "payment-outbox",
      worker: "workers/api",
      payload: JSON.stringify({ type: "batch.dispatched", data: { batchId: "fixture-test" } }),
      description: "Send a representative payment outbox message",
    },
    "payments-batch-count": {
      type: "d1",
      database: "payments-db",
      worker: "workers/api",
      sql: "SELECT COUNT(*) AS batch_count FROM batches;",
      description: "Assert that the seeded example contains one batch",
    },
  },

  dev: {
    endpoints: {
      health: {
        worker: "workers/api",
        path: "/health",
        method: "GET",
        description: "API health endpoint",
      },
      echo: {
        worker: "workers/api",
        path: "/__wd/echo",
        method: "POST",
        description: "Local echo helper for worker call validation",
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
        path: "/__wd/queues/payment-outbox",
      },
    },
    session: {
      entryWorker: "workers/api",
      persistTo: ".wrangler/state",
    },
    snapshots: {
      paths: [".wrangler/state"],
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

  stages: {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },

  verifyLocal: {
    checks: [
      {
        type: "worker",
        name: "api health",
        worker: "workers/api",
        fixture: "api-health",
        expectStatus: 200,
        expectBodyIncludes: ['"ok":true'],
      },
      {
        type: "d1Reset",
        name: "reset payments db",
        database: "payments-db",
      },
      {
        type: "d1Seed",
        name: "seed payments db",
        database: "payments-db",
      },
      {
        type: "d1",
        name: "seeded batch count",
        database: "payments-db",
        fixture: "payments-batch-count",
        expectTextIncludes: ['"batch_count": 1'],
      },
      {
        type: "queue",
        name: "payment outbox accepts payloads",
        queue: "payment-outbox",
        fixture: "payment-outbox-dispatch",
        expectStatus: 200,
        expectBodyIncludes: ['"queued":true'],
      },
      {
        type: "cron",
        name: "batch workflow cron route",
        worker: "workers/batch-workflow",
        expectStatus: 200,
        expectBodyIncludes: ["ok"],
      },
    ],
    packs: {
      smoke: {
        description: "Fast local smoke test for CI and dev sessions",
        checks: [
          {
            type: "worker",
            name: "api health json",
            worker: "workers/api",
            fixture: "api-health",
            expectStatus: 200,
            expectJsonIncludes: { ok: true },
          },
          {
            type: "queue",
            name: "queue fixture accepted",
            queue: "payment-outbox",
            fixture: "payment-outbox-dispatch",
            expectStatus: 200,
            expectJsonIncludes: { queued: true },
          },
        ],
      },
      regression: {
        description: "Reset, seed, verify D1, queue, and cron in one local run",
        checks: [
          {
            type: "d1Reset",
            name: "reset payments db",
            database: "payments-db",
          },
          {
            type: "d1Seed",
            name: "seed payments db",
            database: "payments-db",
          },
          {
            type: "d1",
            name: "seeded batch count json",
            database: "payments-db",
            fixture: "payments-batch-count",
            expectJsonIncludes: [{ results: [{ batch_count: 1 }] }],
          },
          {
            type: "cron",
            name: "batch workflow cron route",
            worker: "workers/batch-workflow",
            expectStatus: 200,
            expectBodyIncludes: ["ok"],
          },
        ],
      },
    },
  },
});
