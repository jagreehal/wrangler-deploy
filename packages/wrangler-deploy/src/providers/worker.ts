import { cfApi as defaultCfApi, type CloudflareApiOptions } from "./cloudflare-api.js";
import { AgentErrors } from "../core/cli-output.js";

export type CfApiFn = typeof defaultCfApi;

export async function deleteWorker(
  name: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<void> {
  const res = await cfApiFn(`/workers/scripts/${name}`, options, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw AgentErrors.network(`Failed to delete worker "${name}": ${res.status}`, "Inspect the error and retry if transient.");
  }
}
