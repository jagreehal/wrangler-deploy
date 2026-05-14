import { createInterface } from "node:readline";
import type { StageState, WorkerState } from "../types.js";
import { AgentErrors } from "./cli-output.js";

export type WorkerChoice = {
  workerPath: string;
  worker: WorkerState;
};

export function listWorkersWithUrl(stageState: StageState): WorkerChoice[] {
  return Object.entries(stageState.workers)
    .filter(([, worker]) => !!worker.url)
    .map(([workerPath, worker]) => ({ workerPath, worker }));
}

export function resolveDefaultWorker(stageState: StageState, entries: WorkerChoice[]): WorkerChoice | undefined {
  if (entries.length === 0) return undefined;
  if (stageState.lastDeployedWorker) {
    const match = entries.find((entry) => entry.workerPath === stageState.lastDeployedWorker);
    if (match) return match;
  }
  return entries[0];
}

export function matchWorker(stageState: StageState, target: string): WorkerChoice | undefined {
  const entry = Object.entries(stageState.workers).find(([path, worker]) => path === target || worker.name === target);
  if (!entry) return undefined;
  return { workerPath: entry[0], worker: entry[1] };
}

export async function promptWorkerChoice(stage: string, entries: WorkerChoice[]): Promise<WorkerChoice | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));
  try {
    console.log(`\n  Multiple workers in stage "${stage}":\n`);
    entries.forEach((entry, index) => {
      console.log(`    ${index + 1}. ${entry.worker.name} (${entry.workerPath})`);
    });
    const answer = (await ask("\n  Select worker number (Enter to cancel): ")).trim();
    if (!answer) return undefined;
    const index = Number.parseInt(answer, 10);
    if (!Number.isInteger(index) || index < 1 || index > entries.length) {
      throw AgentErrors.validation(`Invalid selection "${answer}". Enter a number between 1 and ${entries.length}.`, `Enter a number between 1 and ${entries.length}.`);
    }
    return entries[index - 1];
  } finally {
    rl.close();
  }
}
