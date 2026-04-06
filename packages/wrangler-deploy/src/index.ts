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

// Graph & Visibility
export { buildRichGraph, type RichGraph, type RichNode, type RichEdge, type RichNodeType, type RichEdgeType } from "./core/graph-model.js";
export { analyzeImpact, type ImpactResult, type UpstreamDep, type DownstreamDep } from "./core/impact.js";
export { diffStages, type StageDiffResult, type ResourceDiff, type WorkerDiff, type SecretDiff } from "./core/stage-diff.js";
export { renderAscii } from "./core/renderers/ascii.js";
export { renderMermaid } from "./core/renderers/mermaid.js";
export { renderDot } from "./core/renderers/dot.js";
export { renderJson } from "./core/renderers/json.js";

// Dev
export { buildDevPlan, startDev, type DevPlan, type DevOptions, type WorkerDevPlan, type DevHandle } from "./core/dev.js";
export { assignPorts } from "./core/dev-ports.js";
export { createLogMultiplexer, type LogMultiplexer } from "./core/dev-logs.js";
export { findAvailablePorts } from "./core/port-finder.js";

// CI
export { detectCiEnvironment } from "./core/ci/detect.js";
export { createGitHubProvider } from "./core/ci/github.js";
export { buildPrComment } from "./core/ci/comment.js";
export { postCheckRun, type CheckResult } from "./core/ci/check.js";
export { generateGitHubWorkflow } from "./core/ci/workflow-gen.js";
export type { CiContext, CiProvider } from "./core/ci/types.js";

// Managed
export { writeManagedBindings, type ManagedEnvSection } from "./core/managed.js";
export { updateJsonc } from "./core/jsonc-writer.js";

// Diagnostics
export { runDoctor, type DoctorCheck, type DoctorDeps } from "./core/doctor.js";
export { validateConfig } from "./core/validate-config.js";
export { generateCompletions } from "./core/completions.js";

// Timer
export { createTimer } from "./core/timer.js";
