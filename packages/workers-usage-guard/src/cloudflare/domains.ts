// src/cloudflare/domains.ts
import { cfFetch, type CfFetchDeps } from "./api.js";

type WorkerDomain = { id: string; hostname: string; service: string };

export async function detachDomainsForWorker(
  args: { accountId: string; scriptName: string },
  deps: CfFetchDeps
): Promise<string[]> {
  const domains = await cfFetch<WorkerDomain[]>(
    { path: `/accounts/${args.accountId}/workers/domains` },
    deps
  );
  const removed: string[] = [];
  for (const d of domains.filter((x) => x.service === args.scriptName)) {
    await cfFetch(
      { path: `/accounts/${args.accountId}/workers/domains/${d.id}`, method: "DELETE" },
      deps
    );
    removed.push(d.hostname);
  }
  return removed;
}
