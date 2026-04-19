export type CfFetchDeps = { fetch: typeof fetch; token: string };

export async function cfFetch<T>(
  args: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  },
  deps: CfFetchDeps
): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4${args.path}`;
  const res = await deps.fetch(url, {
    method: args.method ?? "GET",
    headers: {
      authorization: `Bearer ${deps.token}`,
      "content-type": "application/json",
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Cloudflare API ${args.method ?? "GET"} ${args.path} failed: ${
        res.status
      } ${text.slice(0, 500)}`
    );
  }
  const parsed = text
    ? (JSON.parse(text) as { result: T })
    : { result: undefined as T };
  return parsed.result;
}
