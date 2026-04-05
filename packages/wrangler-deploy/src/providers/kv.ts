import { cfApi as defaultCfApi, cfApiResult, type CloudflareApiOptions } from "./cloudflare-api.js";

export type CfApiFn = typeof defaultCfApi;

export interface KvNamespace {
  id: string;
  title: string;
}

export async function createKvNamespace(
  title: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<KvNamespace> {
  const res = await cfApiFn("/storage/kv/namespaces", options, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  // If already exists, try to find it
  if (!res.ok) {
    const body = await res.json() as { errors?: Array<{ code: number }> };
    if (body.errors?.some((e) => e.code === 10014 || e.code === 10026)) {
      // Namespace already exists — find by title
      return await findKvNamespaceByTitle(title, options, cfApiFn);
    }
    throw new Error(`Failed to create KV namespace "${title}": ${res.status}`);
  }

  return cfApiResult<KvNamespace>(res);
}

export async function findKvNamespaceByTitle(
  title: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<KvNamespace> {
  const res = await cfApiFn(`/storage/kv/namespaces?per_page=100`, options);
  const namespaces = await cfApiResult<KvNamespace[]>(res);
  const found = namespaces.find((ns) => ns.title === title);
  if (!found) throw new Error(`KV namespace "${title}" not found`);
  return found;
}

export async function getKvNamespace(
  id: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<KvNamespace | null> {
  const res = await cfApiFn(`/storage/kv/namespaces/${id}`, options);
  if (res.status === 404) return null;
  return cfApiResult<KvNamespace>(res);
}

export async function deleteKvNamespace(
  id: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<void> {
  const res = await cfApiFn(`/storage/kv/namespaces/${id}`, options, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete KV namespace ${id}: ${res.status}`);
  }
}
