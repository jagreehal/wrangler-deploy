import type { NotificationChannel, NotifyDeps } from "../types.js";
import { ok } from "../types.js";

export function noopAdapter(name = "noop"): NotificationChannel {
  return {
    name,
    kind: "webhook",
    async send({ dedupKey }, deps: NotifyDeps) {
      return ok(name, dedupKey, deps.clock().toISOString());
    },
  };
}
