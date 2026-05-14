import type { DnsRecordType } from "../types.js";
import { AgentErrors } from "../core/cli-output.js";

/**
 * Provider for Cloudflare DNS records. Zone-scoped (not account-scoped),
 * so it bypasses the account-prefixed cfApi helper.
 *
 * The Cloudflare DNS Records API:
 * https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface DnsApiOptions {
  apiToken: string;
}

export interface DnsRecord {
  id: string;
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

export type FetchFn = typeof fetch;

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as CfEnvelope<T>;
  if (!body.success) {
    const errors = body.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") ?? "unknown error";
    throw AgentErrors.network(`Cloudflare DNS API error: ${errors}`, "Inspect the error and retry if transient.");
  }
  return body.result;
}

function authHeaders(apiToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
}

/**
 * Look up a zone ID by name. The token must have Zone:Read for the zone.
 */
export async function findZoneId(
  zoneName: string,
  options: DnsApiOptions,
  fetchFn: FetchFn = fetch,
): Promise<string> {
  const res = await fetchFn(
    `${CF_API_BASE}/zones?name=${encodeURIComponent(zoneName)}`,
    { headers: authHeaders(options.apiToken) },
  );
  const zones = await unwrap<Array<{ id: string; name: string }>>(res);
  const found = zones.find((z) => z.name === zoneName);
  if (!found) throw AgentErrors.notFound(`Cloudflare zone not found: ${zoneName}`, "Verify the zone exists in your account and the API token has Zone:Read permission.");
  return found.id;
}

export async function listDnsRecords(
  zoneId: string,
  options: DnsApiOptions,
  fetchFn: FetchFn = fetch,
): Promise<DnsRecord[]> {
  const res = await fetchFn(
    `${CF_API_BASE}/zones/${zoneId}/dns_records?per_page=1000`,
    { headers: authHeaders(options.apiToken) },
  );
  return unwrap<DnsRecord[]>(res);
}

export interface CreateDnsRecordInput {
  type: DnsRecordType;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
}

export async function createDnsRecord(
  zoneId: string,
  input: CreateDnsRecordInput,
  options: DnsApiOptions,
  fetchFn: FetchFn = fetch,
): Promise<DnsRecord> {
  const res = await fetchFn(`${CF_API_BASE}/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: authHeaders(options.apiToken),
    body: JSON.stringify(input),
  });
  return unwrap<DnsRecord>(res);
}

export async function updateDnsRecord(
  zoneId: string,
  recordId: string,
  input: CreateDnsRecordInput,
  options: DnsApiOptions,
  fetchFn: FetchFn = fetch,
): Promise<DnsRecord> {
  const res = await fetchFn(`${CF_API_BASE}/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PUT",
    headers: authHeaders(options.apiToken),
    body: JSON.stringify(input),
  });
  return unwrap<DnsRecord>(res);
}

export async function deleteDnsRecord(
  zoneId: string,
  recordId: string,
  options: DnsApiOptions,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const res = await fetchFn(`${CF_API_BASE}/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
    headers: authHeaders(options.apiToken),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw AgentErrors.network(`Failed to delete DNS record ${recordId}: ${res.status} ${body}`, "Inspect the error and retry if transient.");
  }
}

/**
 * Reconcile a desired set of records against what's live in Cloudflare.
 * Records are matched by (type, name) — Cloudflare allows multiple records
 * with the same (type, name) pair (e.g. round-robin A records), but the
 * common case is one-per-name and that's what wrangler-deploy supports.
 *
 * Returns the live records (post-reconcile) so the caller can persist
 * IDs in state.
 */
export async function reconcileDnsRecords(
  zoneId: string,
  desired: CreateDnsRecordInput[],
  options: DnsApiOptions,
  fetchFn: FetchFn = fetch,
): Promise<DnsRecord[]> {
  const live = await listDnsRecords(zoneId, options, fetchFn);
  const final: DnsRecord[] = [];

  for (const want of desired) {
    const existing = live.find((r) => r.type === want.type && r.name === want.name);
    if (!existing) {
      final.push(await createDnsRecord(zoneId, want, options, fetchFn));
      continue;
    }
    const drifted =
      existing.content !== want.content ||
      (want.ttl !== undefined && existing.ttl !== want.ttl) ||
      (want.proxied !== undefined && existing.proxied !== want.proxied);
    if (drifted) {
      final.push(await updateDnsRecord(zoneId, existing.id, want, options, fetchFn));
    } else {
      final.push(existing);
    }
  }

  return final;
}
