import type { DeployedWorker } from "./deploy.js";
import type { StageState } from "../types.js";

export type DeploymentEvent = {
  at: string;
  action: "deploy" | "rollback";
  workerPath: string;
  workerName: string;
  versionId?: string;
  urls: string[];
  routes: string[];
};

const MAX_HISTORY_EVENTS = 200;

export function appendDeployEvents(state: StageState, deployedWorkers: DeployedWorker[], nowIso: string = new Date().toISOString()): void {
  const events = deployedWorkers.map((worker) => ({
    at: nowIso,
    action: "deploy" as const,
    workerPath: worker.workerPath,
    workerName: worker.name,
    versionId: worker.versionId,
    urls: worker.urls,
    routes: worker.routes,
  }));
  if (events.length === 0) return;
  state.deploymentHistory = [...(state.deploymentHistory ?? []), ...events].slice(-MAX_HISTORY_EVENTS);
}

export function appendRollbackEvent(
  state: StageState,
  event: Omit<DeploymentEvent, "at" | "action">,
  nowIso: string = new Date().toISOString(),
): void {
  const rollbackEvent: DeploymentEvent = {
    at: nowIso,
    action: "rollback",
    ...event,
  };
  state.deploymentHistory = [
    ...(state.deploymentHistory ?? []),
    rollbackEvent,
  ].slice(-MAX_HISTORY_EVENTS);
}

export function listKnownVersions(state: StageState, workerPath: string, workerName: string): string[] {
  const versions = new Set<string>();
  for (const event of state.deploymentHistory ?? []) {
    if (event.workerPath !== workerPath && event.workerName !== workerName) continue;
    if (event.versionId) versions.add(event.versionId);
  }
  const current = state.workers[workerPath]?.versionId;
  if (current) versions.add(current);
  return [...versions];
}
