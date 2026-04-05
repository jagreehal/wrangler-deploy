import type { CiContext, CiProvider } from "./types.js";

export function createGitHubProvider(
  context: CiContext,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): CiProvider {
  const baseUrl = `https://api.github.com/repos/${context.repo}`;
  const headers = {
    Authorization: `Bearer ${context.token}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
  };

  async function request(url: string, opts: RequestInit): Promise<unknown> {
    const res = await fetchFn(url, { ...opts, headers: { ...headers, ...(opts.headers ?? {}) } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  return {
    async postComment(prNumber: number, body: string): Promise<void> {
      await request(`${baseUrl}/issues/${prNumber}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
    },

    async updateComment(prNumber: number, body: string, marker: string): Promise<void> {
      const fullBody = `${marker}\n${body}`;

      // List existing comments
      const comments = (await request(`${baseUrl}/issues/${prNumber}/comments`, {
        method: "GET",
      })) as Array<{ id: number; body: string }>;

      const existing = comments.find((c) => c.body.includes(marker));

      if (existing) {
        await request(`${baseUrl}/issues/comments/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body: fullBody }),
        });
      } else {
        await request(`${baseUrl}/issues/${prNumber}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: fullBody }),
        });
      }
    },

    async createCheckRun(
      name: string,
      status: "success" | "failure",
      details: string,
    ): Promise<void> {
      await request(`${baseUrl}/check-runs`, {
        method: "POST",
        body: JSON.stringify({
          name,
          head_sha: context.sha ?? "",
          status: "completed",
          conclusion: status,
          output: {
            title: name,
            summary: details,
          },
        }),
      });
    },
  };
}
