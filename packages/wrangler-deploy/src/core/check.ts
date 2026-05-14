import type { DoctorCheck } from "./doctor.js";
import type { Plan } from "../types.js";

export function evaluateCheck({
  pack,
  checks,
  plan,
}: {
  pack: "full" | "doctor-only" | "plan-only";
  checks: DoctorCheck[];
  plan: Plan | null;
}): { ok: boolean; doctorOk: boolean; planOk: boolean } {
  const doctorOk = checks.every((check) => check.status === "pass");
  const planOk = plan
    ? !plan.items.some((item) => item.action === "drifted" || item.action === "orphaned")
    : true;

  if (pack === "doctor-only") return { ok: doctorOk, doctorOk, planOk };
  if (pack === "plan-only") return { ok: planOk, doctorOk, planOk };
  return { ok: doctorOk && planOk, doctorOk, planOk };
}
