import { cfApi as defaultCfApi, cfApiResult, type CloudflareApiOptions } from "./cloudflare-api.js";
import { AgentErrors } from "../core/cli-output.js";

export type CfApiFn = typeof defaultCfApi;

export interface QueueInfo {
  queue_id: string;
  queue_name: string;
}

export async function createQueue(
  name: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<QueueInfo> {
  const res = await cfApiFn("/queues", options, {
    method: "POST",
    body: JSON.stringify({ queue_name: name }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Queue already exists — find it
    if (body.includes("already exists") || res.status === 409) {
      return await findQueueByName(name, options, cfApiFn);
    }
    throw AgentErrors.network(`Failed to create queue "${name}": ${res.status} ${body}`, "Inspect the error and retry if transient.");
  }

  return cfApiResult<QueueInfo>(res);
}

export async function findQueueByName(
  name: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<QueueInfo> {
  const res = await cfApiFn("/queues", options);
  const queues = await cfApiResult<QueueInfo[]>(res);
  const found = queues.find((q) => q.queue_name === name);
  if (!found) throw AgentErrors.notFound(`Queue "${name}" not found`, "Run `wd state list` to see provisioned queues for this stage.");
  return found;
}

export async function getQueue(
  id: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<QueueInfo | null> {
  const res = await cfApiFn(`/queues/${id}`, options);
  if (res.status === 404) return null;
  return cfApiResult<QueueInfo>(res);
}

export async function deleteQueue(
  id: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<void> {
  const res = await cfApiFn(`/queues/${id}`, options, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw AgentErrors.network(`Failed to delete queue ${id}: ${res.status}`, "Inspect the error and retry if transient.");
  }
}
