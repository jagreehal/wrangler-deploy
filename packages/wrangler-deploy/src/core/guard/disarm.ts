import type { GuardClient, GuardClientDeps } from "./client.js";

export type DisarmDeps = {
  client: Pick<GuardClient, "post">;
};

export type ArmDeps = {
  client: Pick<GuardClient, "delete">;
};

export async function runDisarm(
  args: { accountId: string; scriptName: string; addedBy: string; reason?: string },
  deps: DisarmDeps,
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<{ ok: true }> {
  const body: Record<string, string> = {
    accountId: args.accountId,
    scriptName: args.scriptName,
    addedBy: args.addedBy,
  };
  if (args.reason) body.reason = args.reason;
  return deps.client.post<{ ok: true }>("/api/disarm", body, clientDeps);
}

export async function runArm(
  args: { accountId: string; scriptName: string },
  deps: ArmDeps,
  clientDeps: GuardClientDeps = { now: () => new Date(), fetch }
): Promise<{ ok: true }> {
  return deps.client.delete<{ ok: true }>(
    "/api/disarm",
    { accountId: args.accountId, scriptName: args.scriptName },
    clientDeps
  );
}
