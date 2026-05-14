import { Hono } from "hono";
import type { apiEnv } from "../../../wrangler-deploy.config.ts";

const app = new Hono<{ Bindings: typeof apiEnv.Env }>();

app.get("/api", async (c) => {
  const current = Number((await c.env.APP_STATE.get("visits")) ?? "0") + 1;
  await c.env.APP_STATE.put("visits", String(current));

  return c.json({
    ok: true,
    message: "Hello from Cloudflare Workers",
    visits: current,
  });
});

export default app;
