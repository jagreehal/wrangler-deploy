import type { NotificationEvent, NotificationResult } from "usage-guard-shared";
import type { SsrfValidator } from "./ssrf.js";
import type { ActivityEvent } from "usage-guard-shared";

export type NotifyDeps = {
  fetch: typeof fetch;
  clock: () => Date;
  ssrf: SsrfValidator;
  secrets: (name: string) => string | undefined;
  log: (entry: ActivityEvent) => Promise<void>;
};

export type NotificationChannel = {
  readonly name: string;
  readonly kind: "discord" | "slack" | "webhook";
  send(
    args: { event: NotificationEvent; dedupKey: string },
    deps: NotifyDeps
  ): Promise<NotificationResult>;
};

export function err(
  channel: string,
  code: "SSRF" | "NON_2XX" | "TIMEOUT" | "BAD_CONFIG",
  message: string
): NotificationResult {
  return { ok: false, channel, error: { code, message } };
}

export function ok(channel: string, dedupKey: string, sentAt: string): NotificationResult {
  return { ok: true, channel, sentAt, dedupKey };
}

export async function postWithTimeout(
  args: { url: string; body: string; headers?: Record<string, string>; timeoutMs?: number },
  deps: { fetch: typeof fetch }
): Promise<{ status: number; bodyText: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), args.timeoutMs ?? 10_000);
  try {
    const res = await deps.fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(args.headers ?? {}) },
      body: args.body,
      signal: controller.signal,
    });
    return { status: res.status, bodyText: await res.text().catch(() => "") };
  } finally {
    clearTimeout(t);
  }
}
