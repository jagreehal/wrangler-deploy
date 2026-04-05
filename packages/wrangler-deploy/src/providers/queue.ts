import { cfApi as defaultCfApi, cfApiResult, type CloudflareApiOptions } from "./cloudflare-api.js";

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
    throw new Error(`Failed to create queue "${name}": ${res.status} ${body}`);
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
  if (!found) throw new Error(`Queue "${name}" not found`);
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
    throw new Error(`Failed to delete queue ${id}: ${res.status}`);
  }
}
