export { defineConfig } from "./config.js";
export type { CfStageConfig, ResourceConfig, WorkerRef, StageRule, StateConfig } from "./types.js";

// State providers
export { resolveStateProvider, LocalStateProvider, KvStateProvider } from "./core/state.js";
export type { StateProvider } from "./core/state.js";

// Typed resource system — phantom Env types
export { kv, queue, hyperdrive, d1, r2, vectorize, worker, workflow, secret, workerEnv } from "./typed.js";
export type {
  KvMarker,
  QueueMarker,
  HyperdriveMarker,
  D1Marker,
  R2Marker,
  VectorizeMarker,
  WorkerMarker,
  WorkflowMarker,
  SecretMarker,
  ResourceMarker,
  Bound,
  DeriveEnv,
} from "./typed.js";
