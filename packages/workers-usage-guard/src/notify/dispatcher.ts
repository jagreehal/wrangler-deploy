import type {
  NotificationEvent,
  NotificationResult,
  ActivityEvent,
} from "usage-guard-shared";
import type { NotificationChannel, NotifyDeps } from "./types.js";
import { ok } from "./types.js";
import { isDeduped, recordDedupe } from "../db/dedupe.js";

export type DispatchDeps = NotifyDeps & {
  db: D1Database;
  dedupWindowSeconds: number;
};

export function computeDedupKey(event: NotificationEvent, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  if (event.kind === "breach") return `${event.breach.breachKey}:${day}`;
  if (event.kind === "breach-suppressed") return `${event.breach.breachKey}:suppressed:${day}`;
  if (event.kind === "daily-report") return `daily-report:${day}`;
  if (event.kind === "approval-requested") return `approval-requested:${event.approvalId}`;
  return `deploy-guard-check:${day}`;
}

function logEntry(args: {
  id: string;
  createdAt: string;
  action: string;
  channelName: string;
  result: NotificationResult;
}): ActivityEvent {
  return {
    id: args.id,
    createdAt: args.createdAt,
    actor: "notify:dispatcher",
    action: args.action,
    resourceType: "notification_channel",
    resourceId: args.channelName,
    details: args.result as unknown as Record<string, unknown>,
  };
}

export async function dispatch(
  args: { event: NotificationEvent; channels: NotificationChannel[] },
  deps: DispatchDeps
): Promise<NotificationResult[]> {
  const now = deps.clock();
  const dedupKey = computeDedupKey(args.event, now);

  const settled = await Promise.allSettled(
    args.channels.map(async (channel): Promise<NotificationResult> => {
      const already = await isDeduped(
        {
          dedupKey,
          channelName: channel.name,
          windowSeconds: deps.dedupWindowSeconds,
          now,
        },
        { db: deps.db }
      );
      if (already) {
        const r: NotificationResult = ok(channel.name, dedupKey, now.toISOString());
        await deps.log(
          logEntry({
            id: crypto.randomUUID(),
            createdAt: now.toISOString(),
            action: "notification_deduped",
            channelName: channel.name,
            result: r,
          })
        );
        return r;
      }
      const r = await channel.send({ event: args.event, dedupKey }, deps);
      if (r.ok) {
        await recordDedupe({ dedupKey, channelName: channel.name, now }, { db: deps.db });
      }
      await deps.log(
        logEntry({
          id: crypto.randomUUID(),
          createdAt: now.toISOString(),
          action: r.ok ? "notification_sent" : "notification_failed",
          channelName: channel.name,
          result: r,
        })
      );
      return r;
    })
  );

  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          ok: false,
          channel: args.channels[i]!.name,
          error: { code: "NON_2XX", message: (s.reason as Error)?.message ?? "unknown" },
        }
  );
}
