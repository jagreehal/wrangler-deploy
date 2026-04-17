import type { NotificationChannel, NotifyDeps } from "../types.js";
import { err, ok, postWithTimeout } from "../types.js";

type WebhookConfig = {
  name: string;
  urlSecret: string;
  headers?: Record<string, string>;
  minSeverity?: "warning" | "critical";
};

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 } as const;

export function webhookAdapter(config: WebhookConfig): NotificationChannel {
  return {
    name: config.name,
    kind: "webhook",
    async send({ event, dedupKey }, deps: NotifyDeps) {
      if (config.minSeverity && SEVERITY_RANK[event.severity] < SEVERITY_RANK[config.minSeverity]) {
        return ok(config.name, dedupKey, deps.clock().toISOString());
      }
      const url = deps.secrets(config.urlSecret);
      if (!url) return err(config.name, "BAD_CONFIG", `missing secret ${config.urlSecret}`);
      const v = deps.ssrf.validate(url);
      if (!v.ok) return err(config.name, "SSRF", v.reason);
      const body = JSON.stringify({ dedupKey, event, sentAt: deps.clock().toISOString() });
      try {
        const res = await postWithTimeout(
          { url, body, headers: config.headers ?? {} },
          { fetch: deps.fetch }
        );
        if (res.status < 200 || res.status >= 300) {
          return err(config.name, "NON_2XX", `HTTP ${res.status}: ${res.bodyText.slice(0, 200)}`);
        }
        return ok(config.name, dedupKey, deps.clock().toISOString());
      } catch (e) {
        const msg = (e as Error).message;
        if (/abort/i.test(msg)) return err(config.name, "TIMEOUT", msg);
        return err(config.name, "NON_2XX", msg);
      }
    },
  };
}
