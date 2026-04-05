import type { paymentEventRouterEnv } from "../../../wrangler-deploy.config.ts";

type Env = typeof paymentEventRouterEnv.Env;

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      const event = message.body as { type: string; data: unknown };
      console.log(`[event-router] ${event.type}`);
      try {
        await env.DB.prepare("INSERT INTO events (id, type, data) VALUES (?, ?, ?)")
          .bind(crypto.randomUUID(), event.type, JSON.stringify(event.data))
          .run();
        message.ack();
      } catch (err) {
        console.error("[event-router] Error:", err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
