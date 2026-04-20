import { signRequest } from "../../usage-guard-shared/index.js";

export type GuardClientConfig = {
  endpoint: string;
  signingKey: string;
};

export type GuardClientDeps = {
  now: () => Date;
  fetch: typeof fetch;
};

export type GuardClient = {
  get<T>(path: string, deps: GuardClientDeps): Promise<T>;
  post<T>(path: string, body: unknown, deps: GuardClientDeps): Promise<T>;
  delete<T>(path: string, body: unknown, deps: GuardClientDeps): Promise<T>;
};

export function createGuardClient(config: GuardClientConfig): GuardClient {
  const base = config.endpoint.replace(/\/+$/, "");
  return {
    async get<T>(path: string, deps: GuardClientDeps): Promise<T> {
      const ts = deps.now().toISOString();
      const sig = await signRequest({ method: "GET", path, timestamp: ts, key: config.signingKey });
      const res = await deps.fetch(`${base}${path}`, {
        method: "GET",
        headers: {
          "x-guard-timestamp": ts,
          "x-guard-signature": sig,
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Guard API GET ${path} failed: ${res.status} ${body.slice(0, 500)}`);
      }
      return (await res.json()) as T;
    },
    async post<T>(path: string, body: unknown, deps: GuardClientDeps): Promise<T> {
      const ts = deps.now().toISOString();
      const sig = await signRequest({ method: "POST", path, timestamp: ts, key: config.signingKey });
      const res = await deps.fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-guard-timestamp": ts,
          "x-guard-signature": sig,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        throw new Error(`Guard API POST ${path} failed: ${res.status} ${b.slice(0, 500)}`);
      }
      return (await res.json()) as T;
    },
    async delete<T>(path: string, body: unknown, deps: GuardClientDeps): Promise<T> {
      const ts = deps.now().toISOString();
      const sig = await signRequest({ method: "DELETE", path, timestamp: ts, key: config.signingKey });
      const res = await deps.fetch(`${base}${path}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-guard-timestamp": ts,
          "x-guard-signature": sig,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        throw new Error(`Guard API DELETE ${path} failed: ${res.status} ${b.slice(0, 500)}`);
      }
      return (await res.json()) as T;
    },
  };
}
