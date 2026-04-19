import { cfFetch, type CfFetchDeps } from "./api.js";

export async function disableWorkersDevSubdomain(
  args: { accountId: string; scriptName: string },
  deps: CfFetchDeps
): Promise<void> {
  await cfFetch(
    {
      path: `/accounts/${args.accountId}/workers/services/${args.scriptName}/subdomain`,
      method: "PUT",
      body: { enabled: false },
    },
    deps
  );
}
