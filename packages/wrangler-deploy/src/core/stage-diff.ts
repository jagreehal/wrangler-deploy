import type { StageState } from "../types.js";

export interface ResourceDiff {
  name: string;
  type: string;
  status: "only-in-a" | "only-in-b" | "same" | "different";
  idA?: string;
  idB?: string;
}

export interface WorkerDiff {
  path: string;
  status: "only-in-a" | "only-in-b" | "same";
  nameA?: string;
  nameB?: string;
}

export interface SecretDiff {
  worker: string;
  name: string;
  inA: "set" | "missing" | "absent";
  inB: "set" | "missing" | "absent";
}

export interface StageDiffResult {
  stageA: string;
  stageB: string;
  resources: ResourceDiff[];
  workers: WorkerDiff[];
  secrets: SecretDiff[];
}

export function diffStages(a: StageState, b: StageState): StageDiffResult {
  // Resources
  const resourceNames = new Set([
    ...Object.keys(a.resources),
    ...Object.keys(b.resources),
  ]);

  const resources: ResourceDiff[] = [];
  for (const name of resourceNames) {
    const ra = a.resources[name];
    const rb = b.resources[name];

    if (ra && !rb) {
      resources.push({
        name,
        type: ra.type,
        status: "only-in-a",
        idA: ra.observed.id,
      });
    } else if (!ra && rb) {
      resources.push({
        name,
        type: rb.type,
        status: "only-in-b",
        idB: rb.observed.id,
      });
    } else if (ra && rb) {
      const status = ra.type !== rb.type ? "different" : "same";
      resources.push({
        name,
        type: ra.type,
        status,
        ...(ra.observed.id !== undefined ? { idA: ra.observed.id } : {}),
        ...(rb.observed.id !== undefined ? { idB: rb.observed.id } : {}),
      });
    }
  }

  // Workers
  const workerPaths = new Set([
    ...Object.keys(a.workers),
    ...Object.keys(b.workers),
  ]);

  const workers: WorkerDiff[] = [];
  for (const path of workerPaths) {
    const wa = a.workers[path];
    const wb = b.workers[path];

    if (wa && !wb) {
      workers.push({ path, status: "only-in-a", nameA: wa.name });
    } else if (!wa && wb) {
      workers.push({ path, status: "only-in-b", nameB: wb.name });
    } else if (wa && wb) {
      workers.push({ path, status: "same", nameA: wa.name, nameB: wb.name });
    }
  }

  // Secrets — report only differences
  const secrets: SecretDiff[] = [];
  const allWorkers = new Set([
    ...Object.keys(a.secrets),
    ...Object.keys(b.secrets),
  ]);

  for (const worker of allWorkers) {
    const secretsA = a.secrets[worker] ?? {};
    const secretsB = b.secrets[worker] ?? {};
    const allSecretNames = new Set([
      ...Object.keys(secretsA),
      ...Object.keys(secretsB),
    ]);

    for (const name of allSecretNames) {
      const inA: "set" | "missing" | "absent" = secretsA[name] ?? "absent";
      const inB: "set" | "missing" | "absent" = secretsB[name] ?? "absent";

      if (inA !== inB) {
        secrets.push({ worker, name, inA, inB });
      }
    }
  }

  return {
    stageA: a.stage,
    stageB: b.stage,
    resources,
    workers,
    secrets,
  };
}
