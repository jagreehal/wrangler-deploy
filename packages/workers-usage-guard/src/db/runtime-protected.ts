export type RuntimeProtectedRow = {
  accountId: string;
  scriptName: string;
  addedAt: string;
  addedBy: string;
  reason: string | null;
};

export async function addRuntimeProtection(
  args: {
    accountId: string;
    scriptName: string;
    addedBy: string;
    reason?: string;
    now?: Date;
  },
  deps: { db: D1Database }
): Promise<void> {
  const now = (args.now ?? new Date()).toISOString();
  await deps.db
    .prepare(
      `INSERT INTO runtime_protected (account_id, script_name, added_at, added_by, reason)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(account_id, script_name) DO UPDATE SET
         added_at = excluded.added_at,
         added_by = excluded.added_by,
         reason = excluded.reason`
    )
    .bind(
      args.accountId,
      args.scriptName,
      now,
      args.addedBy,
      args.reason ?? null
    )
    .run();
}

export async function removeRuntimeProtection(
  args: { accountId: string; scriptName: string },
  deps: { db: D1Database }
): Promise<void> {
  await deps.db
    .prepare("DELETE FROM runtime_protected WHERE account_id = ?1 AND script_name = ?2")
    .bind(args.accountId, args.scriptName)
    .run();
}

type Row = {
  account_id: string;
  script_name: string;
  added_at?: string;
  added_by?: string;
  reason?: string | null;
};

export async function listRuntimeProtected(
  args: { accountId: string },
  deps: { db: D1Database }
): Promise<RuntimeProtectedRow[]> {
  const { results } = await deps.db
    .prepare(
      `SELECT account_id, script_name, added_at, added_by, reason
         FROM runtime_protected
        WHERE account_id = ?1
        ORDER BY added_at DESC`
    )
    .bind(args.accountId)
    .all<Required<Row>>();
  return results.map((r) => ({
    accountId: r.account_id,
    scriptName: r.script_name,
    addedAt: r.added_at,
    addedBy: r.added_by,
    reason: r.reason,
  }));
}

export async function loadRuntimeProtectedSet(
  deps: { db: D1Database }
): Promise<Set<string>> {
  const { results } = await deps.db
    .prepare("SELECT account_id, script_name FROM runtime_protected")
    .all<Row>();
  const set = new Set<string>();
  for (const r of results) set.add(`${r.account_id}:${r.script_name}`);
  return set;
}
