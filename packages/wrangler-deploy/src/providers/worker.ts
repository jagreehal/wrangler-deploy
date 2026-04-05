import { cfApi as defaultCfApi, type CloudflareApiOptions } from "./cloudflare-api.js";

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
    throw new Error(`Failed to delete worker "${name}": ${res.status}`);
  }
}
