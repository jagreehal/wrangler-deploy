import type { CiProvider } from "./types.js";
import type { StageState } from "../../types.js";

export interface CheckResult {
  posted: boolean;
  status: "success" | "failure";
  detail: string;
}

/**
 * Post a GitHub check run summarising the state of a stage.
 * Returns the result so the caller can decide on exit code / logging.
 */
export async function postCheckRun(
  provider: CiProvider,
  stage: string,
  state: StageState | null,
): Promise<CheckResult> {
  if (state) {
    const detail = `Stage "${stage}" verified`;
    await provider.createCheckRun("wrangler-deploy/verify", "success", detail);
    return { posted: true, status: "success", detail };
  }

  const detail = `No state found for stage "${stage}"`;
  await provider.createCheckRun("wrangler-deploy/verify", "failure", detail);
  return { posted: true, status: "failure", detail };
}
