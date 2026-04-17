const INCLUDED_REQUESTS = 10_000_000;
const INCLUDED_CPU_MS = 30_000_000;
const COST_PER_M_REQUESTS = 0.30;
const COST_PER_M_CPU_MS = 0.02;

export type CostBreakdown = {
  requestsCost: number;
  cpuCost: number;
  total: number;
};

export function estimateWorkersCost(args: { requests: number; cpuMs: number }): CostBreakdown {
  const extraReq = Math.max(0, args.requests - INCLUDED_REQUESTS);
  const extraCpu = Math.max(0, args.cpuMs - INCLUDED_CPU_MS);
  const requestsCost = (extraReq / 1_000_000) * COST_PER_M_REQUESTS;
  const cpuCost = (extraCpu / 1_000_000) * COST_PER_M_CPU_MS;
  return { requestsCost, cpuCost, total: requestsCost + cpuCost };
}

export function estimateSavingsUsd(args: {
  actual: { requests: number; cpuMs: number };
  hoursSavedEstimate: number;
  periodHours: number;
}): number {
  const { total } = estimateWorkersCost(args.actual);
  const perHour = total / Math.max(1, args.periodHours);
  return Math.max(0, perHour * args.hoursSavedEstimate);
}
