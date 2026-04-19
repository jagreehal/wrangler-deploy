import type { GuardClient, GuardClientDeps } from "./client.js";

export type RuntimeProtectedRow = {
  accountId: string;
  scriptName: string;
  addedAt: string;
  addedBy: string;
  reason: string | null;
};

export type RuntimeProtectedDeps = {
  client: Pick<GuardClient, "get">;
};

export async function runListRuntimeProtected(
  args: { accountId: string },
  deps: RuntimeProtectedDeps,
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<RuntimeProtectedRow[]> {
  const path = `/api/runtime-protected?account=${encodeURIComponent(args.accountId)}`;
  const res = await deps.client.get<{ items: RuntimeProtectedRow[] }>(path, clientDeps);
  return res.items;
}
