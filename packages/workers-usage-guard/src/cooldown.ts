import type { OverageStateRow } from "./db/state.js";

export type SuppressReason = "cooldown" | "grace";

export type SuppressResult =
  | { suppressed: false }
  | { suppressed: true; reason: SuppressReason; until: string };

export function shouldSuppress(args: { row: OverageStateRow | null; now: Date }): SuppressResult {
  if (!args.row) return { suppressed: false };
  const nowIso = args.now.toISOString();
  if (args.row.graceUntil && args.row.graceUntil > nowIso) {
    return { suppressed: true, reason: "grace", until: args.row.graceUntil };
  }
  if (args.row.cooldownUntil > nowIso) {
    return { suppressed: true, reason: "cooldown", until: args.row.cooldownUntil };
  }
  return { suppressed: false };
}

export function computeGraceUntil(args: { now: Date; graceSeconds: number }): string {
  return new Date(args.now.getTime() + args.graceSeconds * 1000).toISOString();
}
