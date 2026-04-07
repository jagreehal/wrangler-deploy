import { Hono } from "hono";
import type { paymentApiEnv } from "../../../wrangler-deploy.config.ts";

// Env derived from wrangler-deploy.config.ts — zero manual type definitions.
// Hover over Env: { DB: D1Database, TOKEN_KV: KVNamespace, OUTBOX_QUEUE: Queue, WORKFLOWS: Fetcher }
type Env = typeof paymentApiEnv.Env;

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, worker: "api" }));

app.all("/__wd/echo", async (c) => {
  const body = c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.text();
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return c.json({
    ok: true,
    worker: "api",
    method: c.req.method,
    path: c.req.path,
    query,
    requestId: c.req.header("x-request-id") ?? null,
    body,
  });
});

app.post("/batches", async (c) => {
  const body = await c.req.json<{ payload?: Record<string, unknown> }>();
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO batches (id, status, payload) VALUES (?, 'pending', ?)")
    .bind(id, JSON.stringify(body.payload ?? {}))
    .run();

  return c.json({ id, status: "pending" }, 201);
});

app.post("/dispatch", async (c) => {
  const body = await c.req.json<{ batchId: string }>();

  // Send to queue
  await c.env.OUTBOX_QUEUE.send({
    type: "batch.dispatched",
    data: { batchId: body.batchId },
  });

  // Call batch-workflow via service binding
  const res = await c.env.WORKFLOWS.fetch("https://internal/api/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId: body.batchId }),
  });
  const result = (await res.json()) as Record<string, unknown>;
  return c.json({ dispatched: true, ...result });
});

app.post("/__wd/queues/payment-outbox", async (c) => {
  const body = await c.req.json<unknown>();
  await c.env.OUTBOX_QUEUE.send(body);
  return c.json({ queued: true });
});

app.get("/events", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, type, data, created_at FROM events ORDER BY created_at DESC LIMIT 20",
  ).all();
  return c.json({ events: results });
});

export default app;
