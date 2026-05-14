import type { DoctorCheck } from "./doctor.js";

export type DoctorCode = {
  id: string;
  title: string;
  fix: string;
};

export function codeForDoctorCheck(check: DoctorCheck): DoctorCode {
  if (check.name === "wrangler installed") {
    return {
      id: "WD_DOC_WRANGLER_MISSING",
      title: "Wrangler CLI missing or not executable",
      fix: "Install Wrangler (`pnpm add -D wrangler`) and verify with `npx wrangler --version`.",
    };
  }
  if (check.name === "wrangler auth") {
    return {
      id: "WD_DOC_AUTH_MISSING",
      title: "Cloudflare authentication unavailable",
      fix: "Run `wd configure` and `wd login`, or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.",
    };
  }
  if (check.name.startsWith("worker path:")) {
    return {
      id: "WD_DOC_WORKER_PATH",
      title: "Worker path missing",
      fix: "Create the worker path or update `workers[]` in wrangler-deploy config.",
    };
  }
  if (check.name === "config error") {
    return {
      id: "WD_DOC_CONFIG_INVALID",
      title: "Configuration validation failure",
      fix: "Fix the config error and rerun `wd doctor --strict`.",
    };
  }
  return {
    id: "WD_DOC_GENERIC",
    title: "Doctor check warning/failure",
    fix: "Inspect check details and rerun with `wd doctor --json --codes`.",
  };
}
