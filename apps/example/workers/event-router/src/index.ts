import type { paymentEventRouterEnv } from "../../../wrangler-deploy.config.ts";

type Env = typeof paymentEventRouterEnv.Env;

export default {
  async queue(batch, env) {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    ).run();

    for (const message of batch.messages) {
      const event = message.body as { type: string; data: unknown };
      console.log(`[queue:payment-outbox] ${event.type}`);
      try {
        await env.DB.prepare("INSERT INTO events (id, type, data) VALUES (?, ?, ?)")
          .bind(crypto.randomUUID(), event.type, JSON.stringify(event.data))
          .run();
        message.ack();
      } catch (err) {
        console.error("[queue:payment-outbox] Error:", err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
