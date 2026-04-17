const GQL_URL = "https://api.cloudflare.com/client/v4/graphql";

/** Minimal fetch-compatible function type — runtime-neutral (no DOM/Worker globals). */
export type GqlFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export type GqlDeps = { fetch: GqlFetch; token: string };

export async function gql<T>(
  args: { query: string; variables: Record<string, unknown> },
  deps: GqlDeps
): Promise<T> {
  const res = await deps.fetch(GQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
    body: JSON.stringify({ query: args.query, variables: args.variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error("GraphQL response missing data");
  return json.data;
}

export type WorkerUsage = {
  scriptName: string;
  requests: number;
  cpuMs: number;
};

export type FetchWorkerUsageArgs = {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  scriptNames: string[];
};

const QUERY_WORKERS_USAGE = /* GraphQL */ `
  query WorkersUsage($accountTag: String!, $datetimeStart: Time!, $datetimeEnd: Time!, $scriptNames: [String!]!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(
          filter: {
            datetime_geq: $datetimeStart
            datetime_leq: $datetimeEnd
            scriptName_in: $scriptNames
          }
          limit: 10000
        ) {
          dimensions { scriptName }
          sum { requests cpuTime }
        }
      }
    }
  }
`;

type GraphQLResponse = {
  viewer: {
    accounts: Array<{
      workersInvocationsAdaptive: Array<{
        dimensions: { scriptName: string };
        sum: { requests: number; cpuTime: number };
      }>;
    }>;
  };
};

export async function fetchWorkerUsage(
  args: FetchWorkerUsageArgs,
  deps: GqlDeps
): Promise<{ raw: unknown; rows: WorkerUsage[] }> {
  const raw = await gql<GraphQLResponse>(
    {
      query: QUERY_WORKERS_USAGE,
      variables: {
        accountTag: args.accountId,
        datetimeStart: args.periodStart,
        datetimeEnd: args.periodEnd,
        scriptNames: args.scriptNames,
      },
    },
    deps
  );
  const rows: WorkerUsage[] =
    raw.viewer.accounts[0]?.workersInvocationsAdaptive.map((x) => ({
      scriptName: x.dimensions.scriptName,
      requests: x.sum.requests,
      cpuMs: Math.round(x.sum.cpuTime / 1000),
    })) ?? [];
  return { raw, rows };
}
