import { cfApi as defaultCfApi, cfApiResult, type CloudflareApiOptions } from "./cloudflare-api.js";
import { AgentErrors } from "../core/cli-output.js";

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
    throw AgentErrors.network(`Failed to create Hyperdrive "${name}": ${res.status} ${body}`, "Verify --database-url is reachable from Cloudflare and retry.");
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
  if (!found) throw AgentErrors.notFound(`Hyperdrive config "${name}" not found`, "List hyperdrive configs in the dashboard or `wd state list`.");
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
    throw AgentErrors.network(`Failed to delete Hyperdrive ${id}: ${res.status}`, "Inspect the error and retry if transient.");
  }
}
