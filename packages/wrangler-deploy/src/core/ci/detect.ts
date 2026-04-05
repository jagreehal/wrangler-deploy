import type { CiContext } from "./types.js";

export function detectCiEnvironment(env: Record<string, string | undefined>): CiContext | null {
  if (env.GITHUB_ACTIONS !== "true") return null;

  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;

  if (!token || !repo) return null;

  const ref = env.GITHUB_REF ?? "";
  const prMatch = ref.match(/refs\/pull\/(\d+)\//);
  const prNumber = prMatch?.[1] !== undefined ? parseInt(prMatch[1], 10) : undefined;

  return {
    provider: "github",
    repo,
    token,
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(env.GITHUB_SHA !== undefined ? { sha: env.GITHUB_SHA } : {}),
    ...(env.GITHUB_REF_NAME !== undefined ? { branch: env.GITHUB_REF_NAME } : {}),
  };
}
