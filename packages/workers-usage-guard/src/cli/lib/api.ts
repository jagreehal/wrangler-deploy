import { signRequest } from "workers-usage-guard-shared";

export type ApiClientConfig = {
  endpoint: string;
  signingKey: string;
};

export type ApiClient = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string, body?: unknown): Promise<T>;
};

export type ApiClientDeps = {
  fetch: typeof fetch;
  now: () => Date;
};

export function createApiClient(config: ApiClientConfig, deps: ApiClientDeps = { fetch, now: () => new Date() }): ApiClient {
  const base = config.endpoint.replace(/\/+$/, "");

  async function send<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const ts = deps.now().toISOString();
    const sig = await signRequest({ method, path, timestamp: ts, key: config.signingKey });
    const headers: Record<string, string> = {
      "x-guard-timestamp": ts,
      "x-guard-signature": sig,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await deps.fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Guard API ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  return {
    get: (path) => send("GET", path),
    post: (path, body) => send("POST", path, body ?? {}),
    delete: (path, body) => send("DELETE", path, body ?? {}),
  };
}
