// src/cloudflare/routes.ts
import { cfFetch, type CfFetchDeps } from "./api.js";

export type RemovedRoute = { zoneId: string; routeId: string; pattern: string };

type ZoneRoute = { id: string; pattern: string; script?: string };

export async function detachRoutesForWorker(
  args: { scriptName: string; zones: Array<{ zoneId: string }> },
  deps: CfFetchDeps
): Promise<RemovedRoute[]> {
  const removed: RemovedRoute[] = [];
  for (const { zoneId } of args.zones) {
    const routes = await cfFetch<ZoneRoute[]>({ path: `/zones/${zoneId}/workers/routes` }, deps);
    for (const r of routes.filter((x) => x.script === args.scriptName)) {
      await cfFetch({ path: `/zones/${zoneId}/workers/routes/${r.id}`, method: "DELETE" }, deps);
      removed.push({ zoneId, routeId: r.id, pattern: r.pattern });
    }
  }
  return removed;
}
