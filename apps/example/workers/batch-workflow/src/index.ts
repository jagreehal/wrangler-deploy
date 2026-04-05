import { Hono } from "hono";
import type { paymentBatchWorkflowEnv } from "../../../wrangler-deploy.config.ts";

type Env = typeof paymentBatchWorkflowEnv.Env;

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, worker: "batch-workflow" }));

app.post("/api/dispatch", async (c) => {
  const body = await c.req.json<{ batchId: string }>();
  await c.env.DB.prepare("UPDATE batches SET status = 'processing' WHERE id = ?")
    .bind(body.batchId)
    .run();

  return c.json({ dispatched: true, batchId: body.batchId });
});

export default app;
