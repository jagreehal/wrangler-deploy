import { cfApi as defaultCfApi, cfApiResult, type CloudflareApiOptions } from "./cloudflare-api.js";

export type CfApiFn = typeof defaultCfApi;

export interface HyperdriveConfig {
  id: string;
  name: string;
  origin: {
    host: string;
    port: number;
    database: string;
    user: string;
    scheme: string;
  };
}

export async function createHyperdrive(
  name: string,
  origin: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    scheme?: string;
  },
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<HyperdriveConfig> {
  const res = await cfApiFn("/hyperdrive/configs", options, {
    method: "POST",
    body: JSON.stringify({
      name,
      origin: {
        host: origin.host,
        port: origin.port,
        database: origin.database,
        user: origin.user,
        password: origin.password,
        scheme: origin.scheme ?? "postgres",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (body.includes("already exists") || res.status === 409) {
      return await findHyperdriveByName(name, options, cfApiFn);
    }
    throw new Error(`Failed to create Hyperdrive "${name}": ${res.status} ${body}`);
  }

  return cfApiResult<HyperdriveConfig>(res);
}

export async function findHyperdriveByName(
  name: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<HyperdriveConfig> {
  const res = await cfApiFn("/hyperdrive/configs", options);
  const configs = await cfApiResult<HyperdriveConfig[]>(res);
  const found = configs.find((c) => c.name === name);
  if (!found) throw new Error(`Hyperdrive config "${name}" not found`);
  return found;
}

export async function getHyperdrive(
  id: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<HyperdriveConfig | null> {
  const res = await cfApiFn(`/hyperdrive/configs/${id}`, options);
  if (res.status === 404) return null;
  return cfApiResult<HyperdriveConfig>(res);
}

export async function deleteHyperdrive(
  id: string,
  options: CloudflareApiOptions,
  cfApiFn: CfApiFn = defaultCfApi,
): Promise<void> {
  const res = await cfApiFn(`/hyperdrive/configs/${id}`, options, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete Hyperdrive ${id}: ${res.status}`);
  }
}
