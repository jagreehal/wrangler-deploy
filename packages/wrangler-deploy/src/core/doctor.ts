import type { CfStageConfig } from "../types.js";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: string;
}

export interface DoctorDeps {
  wranglerVersion: () => string;
  wranglerAuth: () => string;
  workerExists: (path: string) => boolean;
  configErrors: string[];
}

export function runDoctor(config: CfStageConfig, deps: DoctorDeps): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // Check wrangler installed
  try {
    const version = deps.wranglerVersion();
    checks.push({
      name: "wrangler installed",
      status: "pass",
      message: `wrangler ${version}`,
    });
  } catch (err) {
    checks.push({
      name: "wrangler installed",
      status: "fail",
      message: "wrangler not found",
      details: (err as Error).message,
    });
  }

  // Check auth
  try {
    const authInfo = deps.wranglerAuth();
    checks.push({
      name: "wrangler auth",
      status: "pass",
      message: authInfo,
    });
  } catch (err) {
    checks.push({
      name: "wrangler auth",
      status: "fail",
      message: "not authenticated",
      details: (err as Error).message,
    });
  }

  // Check worker paths exist
  for (const workerPath of config.workers) {
    const exists = deps.workerExists(workerPath);
    checks.push({
      name: `worker path: ${workerPath}`,
      status: exists ? "pass" : "fail",
      message: exists ? `${workerPath} exists` : `${workerPath} not found`,
    });
  }

  // Check config errors
  if (deps.configErrors.length === 0) {
    checks.push({
      name: "config valid",
      status: "pass",
      message: "No config errors",
    });
  } else {
    for (const error of deps.configErrors) {
      checks.push({
        name: "config error",
        status: "fail",
        message: error,
      });
    }
  }

  return checks;
}
