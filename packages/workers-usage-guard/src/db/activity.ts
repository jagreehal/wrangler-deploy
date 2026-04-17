import type { ActivityEvent } from "usage-guard-shared";

export async function appendActivity(
  args: { event: ActivityEvent },
  deps: { db: D1Database }
): Promise<void> {
  const e = args.event;
  await deps.db
    .prepare(
      `INSERT INTO activity_log
         (id, created_at, actor, action, resource_type, resource_id, details_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(e.id, e.createdAt, e.actor, e.action, e.resourceType, e.resourceId, e.details ? JSON.stringify(e.details) : null)
    .run();
}

export function makeLogger(
  args: { actor: string; nowFn?: () => Date; idFn?: () => string },
  deps: { db: D1Database }
): (entry: Omit<ActivityEvent, "id" | "createdAt" | "actor">) => Promise<void> {
  const now = args.nowFn ?? (() => new Date());
  const id = args.idFn ?? (() => crypto.randomUUID());
  return async (entry) => {
    await appendActivity(
      {
        event: {
          id: id(),
          createdAt: now().toISOString(),
          actor: args.actor,
          ...entry,
        },
      },
      deps
    );
  };
}
