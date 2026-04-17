export async function isDeduped(
  args: { dedupKey: string; channelName: string; windowSeconds: number; now?: Date },
  deps: { db: D1Database }
): Promise<boolean> {
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - args.windowSeconds * 1000).toISOString();
  const row = await deps.db
    .prepare(
      "SELECT sent_at FROM notification_dedupe WHERE dedup_key = ?1 AND channel_name = ?2 AND sent_at >= ?3"
    )
    .bind(args.dedupKey, args.channelName, cutoff)
    .first<{ sent_at: string }>();
  return row !== null;
}

export async function recordDedupe(
  args: { dedupKey: string; channelName: string; now?: Date },
  deps: { db: D1Database }
): Promise<void> {
  const now = args.now ?? new Date();
  await deps.db
    .prepare(
      `INSERT INTO notification_dedupe (dedup_key, channel_name, sent_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(dedup_key, channel_name) DO UPDATE SET sent_at = excluded.sent_at`
    )
    .bind(args.dedupKey, args.channelName, now.toISOString())
    .run();
}
