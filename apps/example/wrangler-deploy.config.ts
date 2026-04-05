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

  stages: {
    production: { protected: true },
    staging: { protected: true },
    "pr-*": { protected: false, ttl: "7d" },
  },
});
