// src/workflows/kill-switch-deps.ts
import type { Env } from "../env.js";
import type { StepDeps } from "./kill-switch.js";
import { isProtected } from "../cloudflare/protected.js";
import { detachRoutesForWorker } from "../cloudflare/routes.js";
import { detachDomainsForWorker } from "../cloudflare/domains.js";
import { disableWorkersDevSubdomain } from "../cloudflare/workers-dev.js";
import { insertBreachForensic, completeBreachForensic } from "../db/forensics.js";
import { appendActivity } from "../db/activity.js";
import { setGraceUntil } from "../db/state.js";
import { loadRuntimeProtectedSet } from "../db/runtime-protected.js";
import { dispatch } from "../notify/dispatcher.js";
import { loadNotificationConfig } from "../config.js";
import { ssrfValidator } from "../notify/ssrf.js";
import { discordAdapter } from "../notify/adapters/discord.js";
import { slackAdapter } from "../notify/adapters/slack.js";
import { webhookAdapter } from "../notify/adapters/webhook.js";
import type { NotificationChannel } from "../notify/types.js";
import type { NotificationChannelConfig } from "usage-guard-shared";

function channelFor(cfg: NotificationChannelConfig): NotificationChannel {
  if (cfg.type === "discord") return discordAdapter(cfg);
  if (cfg.type === "slack") return slackAdapter(cfg);
  return webhookAdapter(cfg);
}

export function makeKillSwitchDeps(env: Env): StepDeps {
  const token = env.CLOUDFLARE_API_TOKEN;
  const notifyConfig = loadNotificationConfig(env.NOTIFICATIONS_JSON);
  const channels = notifyConfig.channels.map(channelFor);

  return {
    now: () => new Date(),
    id: () => crypto.randomUUID(),
    loadRuntimeProtectedSet: () => loadRuntimeProtectedSet({ db: env.DB }),
    isProtected,
    detachRoutes: (args) => detachRoutesForWorker(args, { fetch, token }),
    detachDomains: (args) => detachDomainsForWorker(args, { fetch, token }),
    disableWorkersDev: (args) => disableWorkersDevSubdomain(args, { fetch, token }),
    insertForensic: (args) => insertBreachForensic(args, { db: env.DB }),
    completeForensic: (args) => completeBreachForensic(args, { db: env.DB }),
    appendActivity: (args) => appendActivity(args, { db: env.DB }),
    setGraceUntil: (args) => setGraceUntil(args, { db: env.DB }),
    dispatch: async ({ breachForensic, actions, severity }) => {
      return dispatch(
        { event: { kind: "breach", severity, breach: breachForensic, actions }, channels },
        {
          fetch,
          clock: () => new Date(),
          ssrf: ssrfValidator,
          secrets: (name) => (typeof env[name] === "string" ? (env[name] as string) : undefined),
          log: async (entry) => {
            await appendActivity({ event: entry }, { db: env.DB });
          },
          db: env.DB,
          dedupWindowSeconds: notifyConfig.dedupWindowSeconds,
        }
      );
    },
  };
}
